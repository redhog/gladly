import { AXES, AXES_2D, AXIS_GEOMETRY, AxisRegistry } from "../axes/AxisRegistry.js"
import { Camera } from "../axes/Camera.js"
import { TickLabelAtlas } from "../axes/TickLabelAtlas.js"
import { mat4Identity, mat4Multiply } from "../math/mat4.js"
import { ZoomController } from "../axes/ZoomController.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityKind, getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { getRegisteredColorscales, getRegistered2DColorscales, buildColorscaleTexture, getColorscalesVersion } from "../colorscales/ColorscaleRegistry.js"
import { Float } from "../floats/Float.js"
import { computationSchema, buildTransformSchema, getComputedData } from "../compute/ComputationRegistry.js"
import { DataGroup, normalizeData } from "../data/Data.js"
import { enqueueRegl, compileEnqueuedShaders } from "./ShaderQueue.js"
import { GlBase } from "./GlBase.js"
import { tdrYield } from "../tdr.js"

// Throttle linked-plot renders when the source plot's "blocked lag" is high.
// Blocked lag = max(0, RAF_wait - own_render_time): high when other plots' renders
// are delaying the source's frames, but near zero for fast plots (colorbars, filterbars).
const LINK_THROTTLE_MS      = 150   // ms between renders of a throttled linked plot
const BLOCKED_LAG_THRESHOLD = 30    // ms: throttle kicks in above this blocked lag
const BLOCKED_LAG_ALPHA     = 0.5   // EMA weight — reacts within ~2 samples

function buildPlotSchema(data, config) {
  const layerTypes = getRegisteredLayerTypes()
  // Normalise once — always a DataGroup (or null). Columns are e.g. "input.x1".
  const wrappedData = normalizeData(data)

  // Build fullSchemaData: the normalised DataGroup plus lightweight stubs for each
  // declared transform so that layer schemas enumerate transform output columns.
  // Stubs only need columns() — getData/getQuantityKind/getDomain return null (schema only).
  const transforms = config?.transforms ?? []
  let fullSchemaData = wrappedData
  if (wrappedData && transforms.length > 0) {
    const group = new DataGroup({})
    group._children = { ...wrappedData._children }
    for (const { name, transform: spec } of transforms) {
      const entries = Object.entries(spec)
      if (entries.length !== 1) continue
      const [className] = entries[0]
      const cd = getComputedData(className)
      if (!cd) continue
      group._children[name] = {
        columns: () => cd.columns(),
        getData: () => null,
        getQuantityKind: () => null,
        getDomain: () => null,
      }
    }
    fullSchemaData = group
  }

  const { '$defs': compDefs } = computationSchema(fullSchemaData)

  // wrappedData is already the correctly-shaped DataGroup (columns "input.x1" etc.)
  const { '$defs': transformDefs } = buildTransformSchema(wrappedData)

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: { ...compDefs, ...transformDefs },
    type: "object",
    properties: {
      transforms: {
        type: "array",
        description: "Named data transforms applied before layers. Each item is a { name, transform: { ClassName: params } } object.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            transform: { '$ref': '#/$defs/transform_expression' }
          },
          required: ["name", "transform"],
          additionalProperties: false
        }
      },
      layers: {
        type: "array",
        items: {
          type: "object",
          oneOf: layerTypes.map(typeName => {
            const layerType = getLayerType(typeName)
            return {
              title: typeName,
              properties: {
                [typeName]: layerType.schema(fullSchemaData)
              },
              required: [typeName],
              additionalProperties: false
            }
          })
        }
      },
      axes: {
        type: "object",
        // All axes (spatial, color, filter) are populated by getConfig() after the first render.
        // Using only additionalProperties means no hardcoded axis list appears in the schema;
        // the config editor shows exactly the axes declared by active layers.
        additionalProperties: {
          type: "object",
          properties: {
            quantity_kind: { type: "string" },
            min: { type: "number" },
            max: { type: "number" },
            label: { type: "string" },
            scale: { type: "string", enum: ["linear", "log"] },
            rotate: { type: "boolean" },
            colorscale: {
              type: "string",
              enum: [
                ...getRegisteredColorscales().keys(),
                ...getRegistered2DColorscales().keys()
              ]
            },
            colorbar: {
              type: "string",
              enum: ["none", "vertical", "horizontal"]
            },
            filterbar: {
              type: "string",
              enum: ["none", "vertical", "horizontal"]
            }
          }
        }
      },
      colorbars: {
        type: "array",
        description: "Floating colorbar widgets. Use xAxis+yAxis for 2D, one axis for 1D.",
        items: {
          type: "object",
          properties: {
            xAxis: { type: "string", description: "Quantity kind for the x axis of the colorbar" },
            yAxis: { type: "string", description: "Quantity kind for the y axis of the colorbar" },
            colorscale: {
              type: "string",
              description: "Colorscale override. A 2D colorscale name enables the true-2D path.",
              enum: [
                "none",
                ...getRegisteredColorscales().keys(),
                ...getRegistered2DColorscales().keys()
              ]
            }
          }
        }
      }
    }
  }
}

export class Plot extends GlBase {
  // Registry of float factories keyed by type name.
  // Each entry: { factory(parentPlot, container, opts) → widget, defaultSize(opts) → {width,height} }
  // Populated by Colorbar.js, Filterbar.js, Colorbar2d.js at module load time.
  static _floatFactories = new Map()

  static registerFloatFactory(type, factoryDef) {
    Plot._floatFactories.set(type, factoryDef)
  }

  constructor(container, { margin } = {}) {
    super()
    this.container = container
    this.margin = margin ?? { top: 60, right: 60, bottom: 60, left: 60 }

    // Create canvas element
    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    container.appendChild(this.canvas)

    this.currentConfig = null
    this._lastRawDataArg = undefined
    this.layers = []
    this.axisRegistry = null
    this._renderCallbacks = new Set()
    this._zoomEndCallbacks = new Set()
    this._errorListeners = new Set()
    this._noErrorListeners = new Set()
    this._hasError = false
    this._currentRenderHasError = false
    this._dirty = false
    this._rafId = null
    this._rendering = false
    this._lastRenderEnd = performance.now()
    this._throttleTimerId = null
    this._pendingSourcePlot = null   // source plot of pending linked render (for throttle check)
    this._blockedLag = 0             // EMA of (RAF wait - own render time); high when blocked by others
    this._is3D = false
    this._camera = null
    this._tickLabelAtlas = null
    this._axisLineCmd = null
    this._axisBillboardCmd = null

    // Compiled regl draw commands keyed by vert+frag shader source.
    // Persists across update() calls so shader recompilation is avoided.
    this._shaderCache = new Map()

    // Auto-managed Float widgets keyed by a config-derived tag string.
    // Covers 1D colorbars, 2D colorbars, and filterbars in a single unified Map.
    this._floats = new Map()

    this._setupResizeObserver()
  }

  // Stores new config/data and re-initialises the plot. No link validation.
  // Called directly by PlotGroup so it can validate all plots together after
  // all have been updated.
  async _applyUpdate({ config, data } = {}) {
    if (config !== undefined) this.currentConfig = config
    if (data !== undefined) {
      this._rawData = normalizeData(data)  // normalise once; kept immutable
    }

    if (!this.currentConfig || !this._rawData) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight
    const plotWidth = width - this.margin.left - this.margin.right
    const plotHeight = height - this.margin.top - this.margin.bottom

    // Clamp to at least 1×1 so _initialize() always runs and getConfig() stays
    // accurate even when the container is hidden or too small to fit the margins.
    // The canvas backing store and WebGL context update synchronously; the D3
    // axis pixel ranges will be corrected when the ResizeObserver fires on
    // becoming visible.
    this.canvas.width = Math.max(1, width)
    this.canvas.height = Math.max(1, height)

    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.plotWidth = Math.max(1, plotWidth)
    this.plotHeight = Math.max(1, plotHeight)

    this._warnedMissingDomains = false
    await this._initialize()
    this._syncFloats()
  }

  // Validates that all axes on this plot that are linked to axes on other plots
  // still share the same quantity kind. Throws if any mismatch is found.
  _validateLinks() {
    for (const [name, axis] of this._axisCache) {
      const qk = axis.quantityKind
      if (!qk) continue
      for (const other of axis._linkedAxes) {
        const otherQk = other.quantityKind
        if (otherQk && otherQk !== qk) {
          throw new Error(
            `Axis '${name}' (quantity kind '${qk}') is linked to axis '${other._name}' ` +
            `with incompatible quantity kind '${otherQk}'. ` +
            `Unlink the axes before changing their quantity kinds, or update both plots atomically via PlotGroup.`
          )
        }
      }
    }
  }

  async update({ config, data } = {}) {
    // Skip expensive _initialize() if nothing actually changed.
    if (config !== undefined || data !== undefined) {
      const configSame = config === undefined || JSON.stringify(config) === JSON.stringify(this.currentConfig)
      const dataSame   = data  === undefined || data === this._lastRawDataArg
      if (configSame && dataSame) {
        this.scheduleRender()
        return
      }
    }

    if (data !== undefined) this._lastRawDataArg = data

    const previousConfig = this.currentConfig
    const previousRawData = this._rawData
    try {
      await this._applyUpdate({ config, data })
      this._validateLinks()
      this._group?._updateAutoLinks()
    } catch (error) {
      this.currentConfig = previousConfig
      this._rawData = previousRawData
      throw error
    }
  }

  async forceUpdate() {
    await this.update({})
  }

  getConfig() {
    const axes = { ...(this.currentConfig?.axes ?? {}) }

    if (this.axisRegistry) {
      for (const axisId of AXES) {
        const scale = this.axisRegistry.getScale(axisId)
        if (scale) {
          const [min, max] = scale.domain()
          const qk    = this.axisRegistry.getQkForSlot(axisId)
          const qkDef = qk ? getAxisQuantityKind(qk) : {}
          axes[axisId] = { ...qkDef, ...(axes[axisId] ?? {}), min, max, ...(qk ? { quantity_kind: qk } : {}) }
        }
      }
    }

    if (this.axisRegistry) {
      for (const quantityKind of this.axisRegistry.getColorQuantityKinds()) {
        const domain = this.axisRegistry.getDomain(quantityKind)
        const qkDef = getAxisQuantityKind(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
          colorbar: "none",
          ...qkDef,
          ...existing,
          ...(domain ? { min: domain[0], max: domain[1] } : {}),
        }
      }
      for (const quantityKind of this.axisRegistry.getFilterQuantityKinds()) {
        const bounds = this.axisRegistry.getFilterBounds(quantityKind)
        const qkDef = getAxisQuantityKind(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
          filterbar: "none",
          ...qkDef,
          ...existing,
          ...(bounds?.min !== null && bounds?.min !== undefined ? { min: bounds.min } : {}),
          ...(bounds?.max !== null && bounds?.max !== undefined ? { max: bounds.max } : {}),
        }
      }
    }

    return { transforms: [], colorbars: [], ...this.currentConfig, axes}
  }

  async _initialize() {
    const epoch = ++this._initEpoch
    const { layers = [], axes = {}, colorbars = [], transforms = [] } = this.currentConfig

    if (!this.regl) {
      this._initRegl(this.canvas)
    } else {
      // Notify regl of any canvas dimension change so its internal state stays
      // consistent (e.g. default framebuffer size used by regl.clear).
      this.regl.poll()
    }

    // Destroy GPU buffers owned by the previous layer set before rebuilding.
    for (const layer of this.layers) {
      for (const buf of Object.values(layer._bufferProps ?? {})) {
        if (buf && typeof buf.destroy === 'function') buf.destroy()
      }
    }

    this.layers = []
    this._dataTransformNodes = []

    // Restore original user data before applying transforms (handles re-initialization).
    // Create a fresh shallow copy of _rawData's children so _rawData is never mutated
    // and transform nodes from previous runs don't carry over.
    if (this._rawData != null) {
      const fresh = new DataGroup({})
      fresh._children = { ...this._rawData._children }
      this.currentData = fresh
    }

    this.axisRegistry = new AxisRegistry(this.plotWidth, this.plotHeight)

    // Rebuild the colorscale texture on every _initialize so that colorscales
    // registered after the previous update() are included (matches the GLSL
    // rebuild cadence in createDrawCommand).
    this._rebuildColorscaleTexture()

    await this._processTransforms(transforms, epoch)
    if (this._initEpoch !== epoch) return
    await this._processLayers(layers, this.currentData, epoch)
    if (this._initEpoch !== epoch) return

    // Discard any spatial axis config whose stored quantity_kind doesn't match
    // Discard any spatial axis config whose stored quantity_kind doesn't match
    // what the layers assigned — stale settings from a previous axis type.
    const cleanAxes = { ...axes }
    for (const axisId of AXES) {
      const cfg = cleanAxes[axisId]
      if (cfg?.quantity_kind != null &&
          cfg.quantity_kind !== this.axisRegistry.getQkForSlot(axisId)) {
        delete cleanAxes[axisId]
      }
    }
    this.currentConfig = { ...this.currentConfig, axes: cleanAxes }

    this._setDomains(cleanAxes)

    // Detect 3D mode: any axis outside the 4 standard 2D positions has a scale.
    this._is3D = AXES.some(a => !AXES_2D.includes(a) && this.axisRegistry.getScale(a) !== null)

    // Camera (recreated each _initialize so aspect ratio and 3D flag stay in sync).
    this._camera = new Camera(this._is3D)
    this._camera.resize(this.plotWidth, this.plotHeight)

    // Shared atlas for tick and title labels.
    if (this._tickLabelAtlas) this._tickLabelAtlas.destroy()
    this._tickLabelAtlas = new TickLabelAtlas(this.regl)

    // Compile shared axis draw commands (once per regl context; cached on Plot).
    if (!this._axisLineCmd) this._initAxisCommands()

    // Apply colorscale overrides from top-level colorbars entries. These override any
    // per-axis colorscale from config.axes or quantity kind registry. Applying after
    // _setDomains ensures they take effect last. For 2D colorbars both axes receive the
    // same colorscale name, which resolves to a negative index in the shader, triggering
    // the true-2D colorscale path in map_color_s_2d.
    for (const entry of colorbars) {
      if (!entry.colorscale || entry.colorscale == "none") continue
      if (entry.xAxis) this.axisRegistry.ensureColorAxis(entry.xAxis, entry.colorscale)
      if (entry.yAxis) this.axisRegistry.ensureColorAxis(entry.yAxis, entry.colorscale)
    }

    if (!this._zoomController) this._zoomController = new ZoomController(this)
    this.scheduleRender()
  }

  _rebuildColorscaleTexture() {
    const version = getColorscalesVersion()
    if (this._colorscalesVersion === version) return
    this._colorscalesVersion = version
    const csTexData = buildColorscaleTexture()
    if (!csTexData) return
    if (this.colorscaleTexture) {
      // Reuse the existing texture object — subimage upload avoids a GPU allocation
      // if the dimensions haven't changed.
      const prev = this.colorscaleTexture
      if (prev.width === csTexData.width && prev.height === csTexData.height) {
        prev.subimage({ data: csTexData.data, width: csTexData.width, height: csTexData.height })
        return
      }
      prev.destroy()
    }
    this.colorscaleTexture = this.regl.texture({
      width:  csTexData.width,
      height: csTexData.height,
      data:   csTexData.data,
      format: 'rgba',
      type:   'float',
      mag:    'nearest',
      min:    'nearest',
      wrapS:  'clamp',
      wrapT:  'clamp',
    })
  }

  // Compile the two regl commands shared across all axis rendering.
  // Called once after the first regl context is created.
  _initAxisCommands() {
    const regl = this.regl
    const gl = regl._gl
    if (gl.isContextLost()) return
    try { this._initAxisCommandsInner() } catch (e) {
      console.error('[gladly] _initAxisCommands failed (context may be lost):', e)
    }
  }

  _initAxisCommandsInner() {
    const regl = this.regl

    // Axis lines and tick marks (simple 3D line segments).
    this._axisLineCmd = regl({
      vert: `#version 300 es
precision highp float;
in vec3 a_position;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_position, 1.0); }`,
      frag: `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`,
      attributes: { a_position: regl.prop('positions') },
      uniforms: {
        u_mvp:   regl.prop('mvp'),
        u_color: regl.prop('color'),
      },
      primitive: 'lines',
      count:     regl.prop('count'),
      viewport:  regl.prop('viewport'),
      depth: {
        enable: regl.prop('depthEnable'),
        mask:   true,
      },
    })

    // Billboard quads for tick labels and axis titles.
    // a_anchor:    vec3 — label centre in model space
    // a_offset_px: vec2 — corner offset in HTML pixels (x right, y down)
    // a_uv:        vec2 — atlas UV (v=0 = canvas top)
    this._axisBillboardCmd = regl({
      vert: `#version 300 es
precision highp float;
in vec3 a_anchor;
in vec2 a_offset_px;
in vec2 a_uv;
uniform mat4 u_mvp;
uniform vec2 u_canvas_size;
out vec2 v_uv;
void main() {
  vec4 clip = u_mvp * vec4(a_anchor, 1.0);
  // Project anchor from NDC to HTML-pixel space (x right, y down).
  vec2 ndc_anchor = clip.xy / clip.w;
  vec2 anchor_px  = vec2(
     ndc_anchor.x * 0.5 + 0.5,
    -ndc_anchor.y * 0.5 + 0.5) * u_canvas_size;
  // a_offset_px is in HTML pixels (x right, y down).
  // abs(a_offset_px) = (hw, hh) for every corner; top-left = anchor - (hw, hh).
  // Snap the top-left corner to an integer pixel with floor() so that
  // each pixel maps to exactly one atlas texel and the label is never
  // shifted right by the round-half-up behaviour of round().
  vec2 hw_vec  = abs(a_offset_px);
  vec2 tl_px   = floor(anchor_px - hw_vec);    // snap top-left (always left)
  vec2 vert_px = tl_px + hw_vec + a_offset_px; // reconstruct this corner
  // Convert HTML pixels back to NDC.
  vec2 ndc = vec2(
     vert_px.x / u_canvas_size.x * 2.0 - 1.0,
    -(vert_px.y / u_canvas_size.y * 2.0 - 1.0));
  gl_Position = vec4(ndc, clip.z / clip.w, 1.0);
  v_uv = a_uv;
}`,
      frag: `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 tc = ivec2(v_uv * vec2(textureSize(u_atlas, 0)));
  fragColor = texelFetch(u_atlas, tc, 0);
  if (fragColor.a < 0.05) discard;
}`,
      attributes: {
        a_anchor:    regl.prop('anchors'),
        a_offset_px: regl.prop('offsetsPx'),
        a_uv:        regl.prop('uvs'),
      },
      uniforms: {
        u_mvp:         regl.prop('mvp'),
        u_canvas_size: regl.prop('canvasSize'),
        u_atlas:       regl.prop('atlas'),
      },
      primitive: 'triangles',
      count:     regl.prop('count'),
      viewport:  regl.prop('viewport'),
      depth: {
        enable: regl.prop('depthEnable'),
        mask:   false,   // depth test but don't write — labels don't occlude each other
      },
      blend: {
        enable: true,
        func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 },
      },
    })

  }

  _setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // Defer to next animation frame so the ResizeObserver callback exits
        // before any DOM/layout changes happen, avoiding the "loop completed
        // with undelivered notifications" browser error.
        requestAnimationFrame(async () => {
          try {
            await this.forceUpdate()
          } catch (e) {
            console.error('[gladly] Error during resize-triggered update():', e)
          }
        })
      })
      this.resizeObserver.observe(this.container)
    } else {
      this._resizeHandler = async () => {
        try {
          await this.forceUpdate()
        } catch (e) {
          console.error('[gladly] Error during resize-triggered update():', e)
        }
      }
      window.addEventListener('resize', this._resizeHandler)
    }
  }

  // Returns the quantity kind for any axis ID (spatial or color axis).
  // For color axes, the axis ID IS the quantity kind.
  getAxisQuantityKind(axisId) {
    if (Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, axisId)) {
      return this.axisRegistry ? this.axisRegistry.getQkForSlot(axisId) : null
    }
    return axisId
  }

  // Unified domain getter for spatial, color, and filter axes.
  getAxisDomain(axisId) {
    if (Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, axisId)) {
      const scale = this.axisRegistry?.getScale(axisId)
      return scale ? scale.domain() : null
    }
    if (this.axisRegistry?.hasFilterAxis(axisId)) {
      const bounds = this.axisRegistry.getFilterBounds(axisId)
      if (bounds !== null) return [bounds.min, bounds.max]
    }
    return this.axisRegistry?.getDomain(axisId) ?? null
  }

  // Unified domain setter for spatial, color, and filter axes.
  setAxisDomain(axisId, domain) {
    if (Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, axisId)) {
      const qk = this.axisRegistry?.getQkForSlot(axisId)
      if (qk) {
        this.axisRegistry.setDomain(qk, domain)
        // Keep currentConfig in sync so update() skips _initialize() when only domains changed.
        if (this.currentConfig) {
          const axes = this.currentConfig.axes ?? {}
          this.currentConfig = { ...this.currentConfig, axes: { ...axes, [axisId]: { ...(axes[axisId] ?? {}), min: domain[0], max: domain[1] } } }
        }
      }
    } else if (this.axisRegistry?.hasFilterAxis(axisId)) {
      this.axisRegistry.setFilterBounds(axisId, domain[0], domain[1])
    } else if (this.axisRegistry?.hasAxis(axisId)) {
      this.axisRegistry.setDomain(axisId, domain)
    }
  }

  _syncFloats() {
    const config = this.currentConfig ?? {}
    const axes = config.axes ?? {}
    const colorbarsConfig = config.colorbars ?? []

    // Build a map from tag → { factoryDef, opts, y } for every float that should exist.
    // Tags encode the full config so changing any relevant field destroys and recreates the float.
    // Using tags rather than axis names means orientation changes cause clean destroy+recreate
    // with no separate state to compare.
    const desired = new Map()

    // 1D colorbars declared inline on axes: axes[qk].colorbar = "horizontal"|"vertical"
    for (const [axisName, axisConfig] of Object.entries(axes)) {
      if (AXES.includes(axisName)) continue
      const cb = axisConfig.colorbar
      if (cb === "vertical" || cb === "horizontal") {
        const tag = `colorbar:${axisName}:${cb}`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName, orientation: cb }, y: 10 })
      }
      // Filterbars declared inline on axes: axes[qk].filterbar = "horizontal"|"vertical"
      if (this.axisRegistry?.hasFilterAxis(axisName)) {
        const fb = axisConfig.filterbar
        if (fb === "vertical" || fb === "horizontal") {
          const tag = `filterbar:${axisName}:${fb}`
          const factoryDef = Plot._floatFactories.get('filterbar')
          if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName, orientation: fb }, y: 100 })
        }
      }
    }

    // Top-level colorbars array: 1D or 2D depending on which axes are specified.
    for (const entry of colorbarsConfig) {
      const { xAxis, yAxis } = entry
      if (xAxis && yAxis) {
        // 2D colorbar
        const tag = `colorbar2d:${xAxis}:${yAxis}`
        const factoryDef = Plot._floatFactories.get('colorbar2d')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { xAxis, yAxis }, y: 10 })
      } else if (xAxis) {
        // 1D horizontal colorbar from colorbars array
        const tag = `colorbar:${xAxis}:horizontal`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName: xAxis, orientation: 'horizontal' }, y: 10 })
      } else if (yAxis) {
        // 1D vertical colorbar from colorbars array
        const tag = `colorbar:${yAxis}:vertical`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName: yAxis, orientation: 'vertical' }, y: 10 })
      }
    }

    // Destroy floats whose tag is no longer in desired
    for (const [tag, float] of this._floats) {
      if (!desired.has(tag)) {
        float.destroy()
        this._floats.delete(tag)
      }
    }

    // Create floats for new tags
    for (const [tag, { factoryDef, opts, y }] of desired) {
      if (!this._floats.has(tag)) {
        const size = factoryDef.defaultSize(opts)
        this._floats.set(tag, new Float(
          this,
          (container) => factoryDef.factory(this, container, opts),
          { y, ...size }
        ))
      }
    }
  }

  destroy() {
    for (const float of this._floats.values()) {
      float.destroy()
    }
    this._floats.clear()

    // Clear all axis listeners so linked axes stop trying to update this plot
    for (const axis of this._axisCache.values()) {
      axis._listeners.clear()
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    } else if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler)
    }

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }

    if (this._tickLabelAtlas) {
      this._tickLabelAtlas.destroy()
      this._tickLabelAtlas = null
    }

    this._shaderCache.clear()

    if (this.regl) {
      this.regl.destroy()
      this.regl = null
    }

    this._renderCallbacks.clear()
    this.canvas.remove()
  }

  async _processLayers(layersConfig, data, epoch) {
    for (let configLayerIndex = 0; configLayerIndex < layersConfig.length; configLayerIndex++) {
      const layerSpec = layersConfig[configLayerIndex]
      const entries = Object.entries(layerSpec)
      if (entries.length !== 1) {
        this._emitError(new Error("Each layer specification must have exactly one layer type key"))
        continue
      }

      const [layerTypeName, parameters] = entries[0]
      const layerType = getLayerType(layerTypeName)
      if (!layerType) {
        this._emitError(new Error(`Unknown layer type '${layerTypeName}'`))
        continue
      }

      // Resolve axis config once per layer spec for registration (independent of draw call count).
      const ac = layerType.resolveAxisConfig(parameters, data)
      const axesConfig = this.currentConfig?.axes ?? {}

      // Register spatial axes (null means no axis for that direction).
      // Pass any scale override from config (e.g. "log") so the D3 scale is created correctly.
      if (ac.xAxis) this.axisRegistry.ensureSpatialSlot(ac.xAxis, ac.xAxisQuantityKind, axesConfig[ac.xAxis]?.scale ?? axesConfig[ac.xAxisQuantityKind]?.scale)
      if (ac.yAxis) this.axisRegistry.ensureSpatialSlot(ac.yAxis, ac.yAxisQuantityKind, axesConfig[ac.yAxis]?.scale ?? axesConfig[ac.yAxisQuantityKind]?.scale)
      if (ac.zAxis) this.axisRegistry.ensureSpatialSlot(ac.zAxis, ac.zAxisQuantityKind, axesConfig[ac.zAxis]?.scale ?? axesConfig[ac.zAxisQuantityKind]?.scale)

      // Register color axes (colorscale comes from config or quantity kind registry, not from here)
      for (const quantityKind of Object.values(ac.colorAxisQuantityKinds)) {
        this.axisRegistry.ensureColorAxis(quantityKind)
      }

      // Register filter axes
      for (const quantityKind of Object.values(ac.filterAxisQuantityKinds)) {
        this.axisRegistry.ensureFilterAxis(quantityKind)
      }

      // Create one draw command per GPU config returned by the layer type.
      let gpuLayers
      try {
        gpuLayers = await layerType.createLayer(this.regl, parameters, data, this)
      } catch (e) {
        this._emitError(new Error(`Layer '${layerTypeName}' (index ${configLayerIndex}) failed to create: ${e.message}`, { cause: e }))
        continue
      }
      if (this._initEpoch !== epoch) return
      for (const layer of gpuLayers) {
        layer.configLayerIndex = configLayerIndex
        try {
          layer.draw = await this._compileLayerDraw(layer)
        } catch (e) {
          this._emitError(new Error(`Layer '${layerTypeName}' (index ${configLayerIndex}) failed to build draw command: ${e.message}`, { cause: e }))
          continue
        }
        if (this._initEpoch !== epoch) return
        await tdrYield()
        if (this._initEpoch !== epoch) return
        this.layers.push(layer)
      }
    }
    if (this._initEpoch !== epoch) return
    await compileEnqueuedShaders(this.regl)
  }

  async _compileLayerDraw(layer) {
    const drawConfig = await layer.type.createDrawCommand(this.regl, layer, this)

    // If createDrawCommand returns a function, it fully owns the draw call — pass through.
    if (typeof drawConfig === 'function') return drawConfig

    const shaderKey = drawConfig.vert + '\0' + drawConfig.frag

    // fn[] in uniforms whose first element is a function = tiled texture closures.
    const isTiledTexClosure = (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'function'

    if (!this._shaderCache.has(shaderKey)) {
      // Build a version of the draw config where all layer-specific data
      // (attribute buffers and texture closures) is replaced with regl.prop()
      // references. This compiled command can then be reused for any layer
      // that produces the same shader source, regardless of its data.
      const propAttrs = {}
      for (const [key, val] of Object.entries(drawConfig.attributes)) {
        const rawBuf = val?.buffer instanceof Float32Array ? val.buffer
          : val instanceof Float32Array ? val : null
        if (rawBuf !== null) {
          const propKey = `attr_${key}`
          const divisor = val?.divisor
          propAttrs[key] = divisor !== undefined
            ? { buffer: this.regl.prop(propKey), divisor }
            : this.regl.prop(propKey)
        } else {
          propAttrs[key] = val
        }
      }

      const propUniforms = {}
      for (const [key, val] of Object.entries(drawConfig.uniforms)) {
        propUniforms[key] = (typeof val === 'function' || isTiledTexClosure(val))
          ? this.regl.prop(key) : val
      }

      const propConfig = { ...drawConfig, attributes: propAttrs, uniforms: propUniforms }
      this._shaderCache.set(shaderKey, enqueueRegl(this.regl, propConfig))
    }

    const cmd = this._shaderCache.get(shaderKey)

    // Extract per-layer data: GPU buffers for Float32Array attributes,
    // and texture closures for sampler uniforms.
    const bufferProps = {}
    for (const [key, val] of Object.entries(drawConfig.attributes)) {
      const rawBuf = val?.buffer instanceof Float32Array ? val.buffer
        : val instanceof Float32Array ? val : null
      if (rawBuf !== null) {
        bufferProps[`attr_${key}`] = this.regl.buffer(rawBuf)
      }
    }

    // fn[] = tiled texture closures (per-tile); plain fn = dynamic uniform (same across tiles).
    const tiledTextureClosures = {}
    const dynamicUniforms = {}
    for (const [key, val] of Object.entries(drawConfig.uniforms)) {
      if (isTiledTexClosure(val)) tiledTextureClosures[key] = val
      else if (typeof val === 'function') dynamicUniforms[key] = val
    }

    layer._bufferProps = bufferProps

    return (runtimeProps) => {
      const baseProps = {}
      for (const [key, fn] of Object.entries(dynamicUniforms)) baseProps[key] = fn()
      let nTiles = 1
      for (const fns of Object.values(tiledTextureClosures)) {
        if (fns.length > nTiles) nTiles = fns.length
      }
      for (let t = 0; t < nTiles; t++) {
        const tileProps = {}
        let skip = false
        for (const [key, fns] of Object.entries(tiledTextureClosures)) {
          const tex = (t < fns.length ? fns[t] : fns[0])?.()
          if (tex == null) { skip = true; break }
          tileProps[key] = tex
        }
        if (skip) continue
        cmd({ ...bufferProps, ...baseProps, ...tileProps, ...runtimeProps })
      }
    }
  }

  _setDomains(axesOverrides) {
    this.axisRegistry.applyAutoDomainsFromLayers(this.layers, axesOverrides)
  }

  // Thin wrapper so subclasses (e.g. Colorbar) can override scale-type lookup
  // for axes they proxy from another plot. Implementation delegates to the
  // module-level getScaleTypeFloat which reads from axesConfig directly.
  _getScaleTypeFloat(quantityKind) {
    return getScaleTypeFloat(quantityKind, this.currentConfig?.axes)
  }

  static schema(data, config) {
    return buildPlotSchema(data, config)
  }

  _emitError(error) {
    this._hasError = true
    this._currentRenderHasError = true
    console.error('[gladly]', error)
    const event = { type: 'error', error, message: error.message }
    for (const cb of this._errorListeners) {
      try { cb(event) } catch (e) { console.error('[gladly] Error in error listener:', e) }
    }
  }

  scheduleRender(sourcePlot = null) {
    if (!this.regl) return
    this._dirty = true
    // Track source plot — sticky until RAF is committed so timer/vsync re-entries
    // can still check whether throttling is warranted.
    if (sourcePlot) this._pendingSourcePlot = sourcePlot
    if (this._rafId !== null || this._rendering || this._throttleTimerId !== null) return

    // Throttle only when the source plot is being blocked by slow linked renders.
    // blocked lag = RAF wait − own render time; near zero for fast plots (colorbars,
    // filterbars) so those never throttle this plot's renders.
    const source = this._pendingSourcePlot
    if (source && source._blockedLag > BLOCKED_LAG_THRESHOLD) {
      const delay = LINK_THROTTLE_MS - (performance.now() - this._lastRenderEnd)
      if (delay > 0) {
        this._throttleTimerId = setTimeout(() => {
          this._throttleTimerId = null
          if (this._dirty) this.scheduleRender()
        }, delay)
        return
      }
    }
    this._pendingSourcePlot = null  // commit: reset now that we're queuing the RAF

    const schedTime = performance.now()
    const _st0 = schedTime
    setTimeout(() => {
      const _stLag = performance.now() - _st0
      if (_stLag > 20) console.warn(`[gladly] setTimeout(0) lag ${_stLag.toFixed(0)}ms`)
    }, 0)
    this._rafId = requestAnimationFrame(async (rafTime) => {
      this._rafId = null
      const now = performance.now()
      const lag = now - schedTime
      const postVsync = now - rafTime  // time from vsync to our callback executing
      if (lag > 50) console.warn(`[gladly] RAF lag ${lag.toFixed(0)}ms  (vsync-to-callback: ${postVsync.toFixed(1)}ms)`)
      if (this._dirty) {
        this._dirty = false
        const t0 = performance.now()
        this._rendering = true
        try {
          await this.render()
        } catch (e) {
          console.error('[gladly] Error during render():', e)
        } finally {
          this._rendering = false
        }
        const dt = performance.now() - t0
        if (dt > 10) console.warn(`[gladly] render ${dt.toFixed(0)}ms`)
        // Update blocked-lag EMA: how long were we waiting for others vs rendering ourselves?
        const blockedLag = Math.max(0, lag - dt)
        this._blockedLag = this._blockedLag * (1 - BLOCKED_LAG_ALPHA) + blockedLag * BLOCKED_LAG_ALPHA
        this._lastRenderEnd = performance.now()
        // After submitting GPU work, hold _rafId so no new render can be queued
        // until the compositor is ready for the next frame (browser waits for GPU).
        // Any state changes that arrive during GPU execution are captured then.
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null
          if (this._dirty) this.scheduleRender()
        })
      }
    })
  }

  async render() {
    this._dirty = false
    const hadError = this._hasError
    this._currentRenderHasError = false

    // Validate axis domains once per render (warn only when domain is still
    // the D3 default, i.e. was never set — indicates a missing ensureAxis call)
    if (!this._warnedMissingDomains && this.axisRegistry) {
      for (const axisId of AXES) {
        const scale = this.axisRegistry.getScale(axisId)
        if (!scale) continue
        const [lo, hi] = scale.domain()
        if (!isFinite(lo) || !isFinite(hi)) {
          console.warn(
            `[gladly] Axis '${axisId}': domain [${lo}, ${hi}] is non-finite at render time. ` +
            `All data on this axis will be invisible.`
          )
          this._warnedMissingDomains = true
        } else if (lo === hi) {
          console.warn(
            `[gladly] Axis '${axisId}': domain is degenerate [${lo}] at render time. ` +
            `Data on this axis will collapse to a single line.`
          )
          this._warnedMissingDomains = true
        }
      }
    }
    const viewport = {
      x: this.margin.left,
      y: this.margin.bottom,
      width: this.plotWidth,
      height: this.plotHeight
    }
    const axesConfig = this.currentConfig?.axes

    // Camera MVP for data layers (maps unit cube to NDC within the plot-area viewport).
    const cameraMvp = this._camera ? this._camera.getMVP() : mat4Identity()

    // Axis MVP maps the unit cube to full-canvas NDC so axis lines and labels
    // can extend into the margin area outside the plot viewport.
    //   sx = plotWidth/width,  sy = plotHeight/height
    //   cx = (marginLeft - marginRight) / width  (NDC centre offset x)
    //   cy = (marginBottom - marginTop)  / height
    const sx = this.plotWidth  / this.width
    const sy = this.plotHeight / this.height
    const cx = (this.margin.left   - this.margin.right)  / this.width
    const cy = (this.margin.bottom - this.margin.top)    / this.height
    // Column-major viewport scale+translate matrix
    const Mvp = new Float32Array([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0,  0, 1, 0,
      cx, cy, 0, 1,
    ])
    const axisMvp = mat4Multiply(Mvp, cameraMvp)

    // Phase 1 — async compute: refresh all transforms and data columns before touching the canvas.
    // Any TDR-yield RAF pauses happen here while the previous frame is still visible.
    // Yield between steps when a step is expensive to avoid triggering the Windows TDR watchdog.
    for (const node of this._dataTransformNodes) {
      try {
        await node.refreshIfNeeded(this)
      } catch (e) {
        this._emitError(new Error(`Transform refresh failed: ${e.message}`, { cause: e }))
      }
      await tdrYield()
    }

    const failedLayers = new Set()
    for (const layer of this.layers) {
      for (const col of layer._dataColumns ?? []) {
        try {
          await col.refresh(this)
        } catch (e) {
          this._emitError(new Error(`Layer '${layer.type?.name ?? 'unknown'}' (config index ${layer.configLayerIndex}): column refresh failed: ${e.message}`, { cause: e }))
          failedLayers.add(layer)
          break
        }
        await tdrYield()
      }
    }

    // Phase 2 — synchronous draw: all data is ready; clear once then draw every layer.
    // Yield before touching the canvas so the GPU can complete any pending work from
    // other plots or the previous frame before we submit new draw commands.
    await tdrYield()
    this.regl.clear({ color: [1,1,1,1], depth:1 })

    for (const layer of this.layers) {
      const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
      const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
      const zIsLog = layer.zAxis ? this.axisRegistry.isLogScale(layer.zAxis) : false
      const zScale = layer.zAxis ? this.axisRegistry.getScale(layer.zAxis) : null
      const zDomain = zScale ? zScale.domain() : [0, 1]
      const props = {
        xDomain: layer.xAxis ? (this.axisRegistry.getScale(layer.xAxis)?.domain() ?? [0, 1]) : [0, 1],
        yDomain: layer.yAxis ? (this.axisRegistry.getScale(layer.yAxis)?.domain() ?? [0, 1]) : [0, 1],
        zDomain,
        xScaleType: xIsLog ? 1.0 : 0.0,
        yScaleType: yIsLog ? 1.0 : 0.0,
        zScaleType: zIsLog ? 1.0 : 0.0,
        u_is3D:    this._is3D ? 1.0 : 0.0,
        u_mvp:     cameraMvp,
        viewport: viewport,
        count: layer.vertexCount ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length ?? 0,
        u_pickingMode: 0.0,
        u_pickLayerIndex: 0.0,
      }

      if (layer.instanceCount !== null) {
        props.instances = layer.instanceCount
      }

      // Warn once if this draw call will produce no geometry
      if (!layer._warnedZeroCount && !layer.type?.suppressWarnings) {
        const drawCount = props.instances ?? props.count
        if (drawCount === 0) {
          console.warn(
            `[gladly] Layer '${layer.type?.name ?? 'unknown'}' (config index ${layer.configLayerIndex}): ` +
            `draw count is 0 — nothing will be rendered`
          )
          layer._warnedZeroCount = true
        }
      }

      for (const qk of Object.values(layer.colorAxes)) {
        const pk = qk.replace(/\./g, '_')
        props[`colorscale_${pk}`] = this.axisRegistry.getColorscaleIndex(qk)
        const domain = this.axisRegistry.getDomain(qk)
        props[`color_range_${pk}`] = domain ?? [0, 1]
        props[`color_scale_type_${pk}`] = this._getScaleTypeFloat(qk)
        props[`alpha_blend_${pk}`] = this.axisRegistry.getAlphaBlend(qk)
        props[`color_filter_range_${pk}`] = this.axisRegistry.getColorFilterRangeUniform(qk)
      }

      for (const qk of Object.values(layer.filterAxes)) {
        const pk = qk.replace(/\./g, '_')
        props[`filter_range_${pk}`] = this.axisRegistry.getFilterRangeUniform(qk)
        props[`filter_scale_type_${pk}`] = this._getScaleTypeFloat(qk)
      }

      if (!failedLayers.has(layer)) {
        try {
          layer.draw(props)
        } catch (e) {
          this._emitError(new Error(`Layer '${layer.type?.name ?? 'unknown'}' (config index ${layer.configLayerIndex}): draw failed: ${e.message}`, { cause: e }))
        }
      }
    }

    // Render all registered spatial axes via WebGL (axis lines + tick marks + labels).
    if (this._axisLineCmd && this._axisBillboardCmd && this._tickLabelAtlas) {
      // Pre-pass: mark all labels needed this frame, then flush the atlas once.
      for (const axisId of AXES) {
        if (!this.axisRegistry.getScale(axisId)) continue
        this._getAxis(axisId).prepareAtlas(this._tickLabelAtlas, axisMvp, this.width, this.height)
      }
      this._tickLabelAtlas.flush()

      for (const axisId of AXES) {
        if (!this.axisRegistry.getScale(axisId)) continue
        this._getAxis(axisId).render(
          this.regl, axisMvp, this.width, this.height,
          this._is3D, this._tickLabelAtlas,
          this._axisLineCmd, this._axisBillboardCmd,
        )
      }
    }
    for (const cb of this._renderCallbacks) cb()

    if (hadError && !this._currentRenderHasError) {
      this._hasError = false
      const event = { type: 'no-error' }
      for (const cb of this._noErrorListeners) {
        try { cb(event) } catch (e) { console.error('[gladly] Error in no-error listener:', e) }
      }
    }
  }

  lookup(x, y) {
    const result = {}
    if (!this.axisRegistry) return result
    const plotX = x - this.margin.left
    const plotY = y - this.margin.top
    for (const axisId of AXES) {
      const scale = this.axisRegistry.getScale(axisId)
      if (!scale) continue
      const qk = this.axisRegistry.getQkForSlot(axisId)
      const value = axisId.includes('y') ? scale.invert(plotY) : scale.invert(plotX)
      result[axisId] = value
      if (qk) result[qk] = value
    }
    return result
  }

  onZoomEnd(cb) {
    this._zoomEndCallbacks.add(cb)
    return { remove: () => this._zoomEndCallbacks.delete(cb) }
  }

  on(eventType, callback) {
    if (eventType === 'error') {
      this._errorListeners.add(callback)
      return { remove: () => this._errorListeners.delete(callback) }
    }
    if (eventType === 'no-error') {
      this._noErrorListeners.add(callback)
      return { remove: () => this._noErrorListeners.delete(callback) }
    }
    const handler = (e) => {
      if (!this.container.contains(e.target)) return
      const rect = this.container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      callback(e, this.lookup(x, y))
    }
    window.addEventListener(eventType, handler, { capture: true })
    return { remove: () => window.removeEventListener(eventType, handler, { capture: true }) }
  }

  async pick(x, y) {
    if (!this.regl || !this.layers.length) return null

    const glX = Math.round(x)
    const glY = this.height - Math.round(y) - 1

    if (glX < 0 || glX >= this.width || glY < 0 || glY >= this.height) return null

    const fbo = this.regl.framebuffer({
      width: this.width, height: this.height,
      colorFormat: 'rgba', colorType: 'uint8', depth: false,
    })

    const axesConfig = this.currentConfig?.axes

    // Refresh transform nodes before picking (same as render)
    for (const node of this._dataTransformNodes) {
      await node.refreshIfNeeded(this)
    }

    // Refresh data columns outside the synchronous regl() callback
    for (const layer of this.layers) {
      for (const col of layer._dataColumns ?? []) await col.refresh(this)
    }

    let result = null
    try {
    this.regl({ framebuffer: fbo })(() => {
      this.regl.clear({ color: [0, 0, 0, 0] })
      const viewport = {
        x: this.margin.left, y: this.margin.bottom,
        width: this.plotWidth, height: this.plotHeight
      }
      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i]

        const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
        const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
        const zIsLog = layer.zAxis ? this.axisRegistry.isLogScale(layer.zAxis) : false
        const zScale = layer.zAxis ? this.axisRegistry.getScale(layer.zAxis) : null
        const camMvp = this._camera ? this._camera.getMVP() : mat4Identity()
        const props = {
          xDomain: layer.xAxis ? (this.axisRegistry.getScale(layer.xAxis)?.domain() ?? [0, 1]) : [0, 1],
          yDomain: layer.yAxis ? (this.axisRegistry.getScale(layer.yAxis)?.domain() ?? [0, 1]) : [0, 1],
          zDomain: zScale ? zScale.domain() : [0, 1],
          xScaleType: xIsLog ? 1.0 : 0.0,
          yScaleType: yIsLog ? 1.0 : 0.0,
          zScaleType: zIsLog ? 1.0 : 0.0,
          u_is3D:    this._is3D ? 1.0 : 0.0,
          u_mvp:     camMvp,
          viewport,
          count: layer.vertexCount ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length ?? 0,
          u_pickingMode: 1.0,
          u_pickLayerIndex: i,
        }
        if (layer.instanceCount !== null) props.instances = layer.instanceCount
        for (const qk of Object.values(layer.colorAxes)) {
          const pk = qk.replace(/\./g, '_')
          props[`colorscale_${pk}`] = this.axisRegistry.getColorscaleIndex(qk)
          const domain = this.axisRegistry.getDomain(qk)
          props[`color_range_${pk}`] = domain ?? [0, 1]
          props[`color_scale_type_${pk}`] = this._getScaleTypeFloat(qk)
          props[`alpha_blend_${pk}`] = this.axisRegistry.getAlphaBlend(qk)
          props[`color_filter_range_${pk}`] = this.axisRegistry.getColorFilterRangeUniform(qk)
        }
        for (const qk of Object.values(layer.filterAxes)) {
          const pk = qk.replace(/\./g, '_')
          props[`filter_range_${pk}`] = this.axisRegistry.getFilterRangeUniform(qk)
          props[`filter_scale_type_${pk}`] = this._getScaleTypeFloat(qk)
        }
        layer.draw(props)
      }
      var pixels;
      try {
        pixels = this.regl.read({ x: glX, y: glY, width: 1, height: 1 })
      } catch (e) {
        pixels = [0];
      }
      if (pixels[0] === 0) {
        result = null
      } else {
        const layerIndex = pixels[0] - 1
        const dataIndex = (pixels[1] << 16) | (pixels[2] << 8) | pixels[3]
        const layer = this.layers[layerIndex]
        result = { layerIndex, configLayerIndex: layer.configLayerIndex, dataIndex, layer }
      }
    })
    } finally {
      fbo.destroy()
    }
    return result
  }
}
