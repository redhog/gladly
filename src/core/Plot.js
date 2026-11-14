import { AXES, AXES_2D, AXIS_GEOMETRY, AxisRegistry } from "../axes/AxisRegistry.js"
import { Camera } from "../axes/Camera.js"
import { TickLabelAtlas } from "../axes/TickLabelAtlas.js"
import { mat4Identity, mat4Multiply } from "../math/mat4.js"
import { ZoomController } from "../axes/ZoomController.js"
import { AxisLimitEditor } from "../axes/AxisLimitEditor.js"
import { AxisMenu } from "../floats/AxisMenu.js"
import { Axis2d } from "../axes/Axis2d.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityKind, getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { getRegisteredColorscales, getRegistered2DColorscales, buildColorscaleTexture, getColorscalesVersion } from "../colorscales/ColorscaleRegistry.js"
import { Float } from "../floats/Float.js"
import { computationSchema, buildTransformSchema, getComputedData } from "../compute/ComputationRegistry.js"
import { DataGroup, normalizeData } from "../data/Data.js"
import { enqueueRegl, compileEnqueuedShaders } from "./ShaderQueue.js"
import { GlBase } from "./GlBase.js"
import { tdrYield } from "../tdr.js"
import { globalSelectionRegistry } from "../selection/SelectionRegistry.js"
import { SelectionPipeline } from "../selection/SelectionPipeline.js"
import { LassoInteraction, LASSO_MODES } from "../selection/LassoInteraction.js"
import { getMasterCanvas } from "./MasterCanvas.js"
import { globalResourceRegistry } from "./ResourceRegistry.js"

// Throttle linked-plot renders when the source plot's "blocked lag" is high.
const LINK_THROTTLE_MS      = 150
const BLOCKED_LAG_THRESHOLD = 30
const BLOCKED_LAG_ALPHA     = 0.5

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function buildPlotSchema(data, config) {
  const layerTypes = getRegisteredLayerTypes()
  const wrappedData = normalizeData(data)

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
  const { '$defs': transformDefs } = buildTransformSchema(wrappedData)

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: { ...compDefs, ...transformDefs },
    type: "object",
    properties: {
      axis_menu: {
        type: "boolean",
        default: true,
        description: "When true (the default), a right-click on an axis strip opens gladly's built-in single-axis menu. When false, gladly opens no menu there and the 'contextmenu' event still fires, so a consumer can bind their own."
      },
      plot_menu: {
        type: "boolean",
        default: true,
        description: "When true (the default), a right-click on the plot area / a corner / an empty margin opens gladly's built-in full menu. When false, gladly opens no menu there and the 'contextmenu' event still fires, so a consumer can bind their own."
      },
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
            const layerSchema = layerType.schema(fullSchemaData)
            const layerSchemaWithSelection = {
              ...layerSchema,
              properties: {
                ...(layerSchema.properties ?? {}),
                selection: { type: 'string', default: '', description: 'Selection channel name. Layers sharing the same name and data object are linked.' },
              },
              required: layerSchema.required ?? [],
            }
            return {
              title: typeName,
              properties: { [typeName]: layerSchemaWithSelection },
              required: [typeName],
              additionalProperties: false
            }
          })
        }
      },
      axes: {
        type: "object",
        additionalProperties: {
          type: "object",
          // The boolean axis-part toggles are required with defaults so a schema-driven
          // editor always renders them (an optional, absent key is otherwise hidden).
          required: ["visible", "tickLabelsVisible", "titleVisible", "locked"],
          properties: {
            quantity_kind: { type: "string" },
            min: { type: "number" },
            max: { type: "number" },
            label: { type: "string" },
            scale: { type: "string", enum: ["linear", "log"] },
            visible: { type: "boolean", default: true },
            tickLabelsVisible: { type: "boolean", default: true },
            titleVisible: { type: "boolean", default: true },
            locked: { type: "boolean", default: false },
            rotate: { type: "boolean" },
            colorscale: {
              type: "string",
              enum: [
                ...getRegisteredColorscales().keys(),
                ...getRegistered2DColorscales().keys()
              ]
            },
            colorbar: { type: "string", enum: ["none", "vertical", "horizontal"] },
            filterbar: { type: "string", enum: ["none", "vertical", "horizontal"] }
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
              description: "Colorscale override.",
              enum: [
                "none",
                ...getRegisteredColorscales().keys(),
                ...getRegistered2DColorscales().keys()
              ]
            },
            enabled: {
              type: "boolean",
              default: true,
              description: "When false, this entry does not override its member axes' colorscales; the pair colours from each axis's own colorscale (same state as having no entry at all)."
            },
            colorbar: {
              type: "boolean",
              default: true,
              description: "When false, the floating colorbar widget for this entry is not drawn."
            }
          }
        }
      },
      interactions: {
        type: "object",
        description: "Interactive behaviours.",
        properties: {
          lasso: {
            description: "Lasso selection.",
            oneOf: [
              { type: "boolean", const: true },
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    selection: { type: "string" },
                    trigger: { type: "string", enum: ["shift", "ctrl"], default: "shift" },
                    mode: {
                      type: "string", enum: LASSO_MODES,
                      description: "Selection shape. Without it the plot's current mode applies (see setLassoMode), 'lasso' by default."
                    },
                    bandWidth: {
                      type: "number", exclusiveMinimum: 0,
                      description: "Width of a band click, in the x axis's data units."
                    }
                  },
                  required: ["selection"],
                  additionalProperties: false
                }
              }
            ]
          }
        },
        additionalProperties: false
      }
    }
  }
}

export class Plot extends GlBase {
  static _floatFactories = new Map()

  static registerFloatFactory(type, factoryDef) {
    Plot._floatFactories.set(type, factoryDef)
  }

  constructor(container, { margin, marginWithoutAxis } = {}) {
    super()
    this.container = container
    this._marginWithAxis = margin ?? { top: 60, right: 60, bottom: 60, left: 60 }
    this._marginWithoutAxis = marginWithoutAxis ?? {}
    // The margin in use; _layoutMargin() sets it per side once the axes are known.
    this.margin = this._marginWithAxis

    // Real on-screen display canvas. The shared regl context renders into an
    // OffscreenCanvas and hands each frame to this canvas via its bitmaprenderer
    // context, so every plot is a normal DOM layer the browser composites.
    this._canvas = document.createElement('canvas')
    this._canvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%'
    container.appendChild(this._canvas)
    this._displayCtx = this._canvas.getContext('bitmaprenderer')

    // Shared regl context from the single MasterCanvas.
    this.regl = getMasterCanvas().regl
    getMasterCanvas().register(this)

    this.currentConfig = null
    this._lastRawDataArg = undefined
    this.layers = []
    this.axisRegistry = null
    this._renderCallbacks = new Set()
    this._zoomEndCallbacks = new Set()
    this._errorListeners = new Set()
    this._noErrorListeners = new Set()
    this._axisLimitListeners = new Set()
    this._axisOptionsListeners = new Set()
    this._contextMenuListeners = new Set()
    this._contextMenuOpenListeners = new Set()
    // Set by LassoInteraction when a right press closed a polygon; cleared by
    // ZoomController on the matching mouseup, so that press emits no 'contextmenu'.
    this._rightPressConsumed = false
    this._hasError = false
    this._currentRenderHasError = false
    this._hadError = false
    this._failedLayers = new Set()
    this._dirty = false
    this._throttleTimerId = null
    this._pendingSourcePlot = null
    this._blockedLag = 0
    this._lastRenderEnd = performance.now()
    this._is3D = false
    this._readyEpoch = -1   // the _initEpoch of the last update() that finished; see _isReady()
    this._camera = null
    this._tickLabelAtlas = null

    // Compiled regl draw commands keyed by vert+frag shader source.
    this._shaderCache = new Map()

    // Auto-managed Float widgets keyed by a config-derived tag string.
    this._floats = new Map()

    // Stable Axis2d handles for 2D colour pairings, keyed by "<qkX>__<qkY>".
    this._axis2dCache = new Map()
    this._axis2dProxy = null

    this._setupResizeObserver()
  }

  // The live set of 2D colour pairs the layers fuse via colorAxes2d, as "<qkX>__<qkY>" keys.
  _axis2dKeys() {
    const keys = []
    for (const layer of this.layers) {
      for (const [, [sa, sb]] of Object.entries(layer.colorAxes2d ?? {})) {
        const qkX = layer.colorAxes[sa]
        const qkY = layer.colorAxes[sb]
        if (qkX != null && qkY != null) keys.push(Axis2d.makeKey(qkX, qkY))
      }
    }
    return [...new Set(keys)]
  }

  /**
   * Returns a stable Axis2d handle for a 2D colour pairing, keyed by the ordered
   * pair "<qkX>__<qkY>" (e.g. plot.axis2d.velocity_ms__density, or the equivalent
   * bracket form plot.axis2d["velocity_ms__density"]). Created on first
   * access; the same instance is returned across update() calls. Enumeration
   * (Object.keys / for..in / `in`) reflects exactly the pairs the layers currently
   * fuse via colorAxes2d — a pair with no backing layer is absent (but still
   * accessible and inert).
   */
  get axis2d() {
    if (!this._axis2dProxy) {
      this._axis2dProxy = new Proxy(this._axis2dCache, {
        get: (cache, key) => {
          if (typeof key !== 'string') return undefined
          if (!cache.has(key)) {
            const [xAxis, yAxis] = Axis2d.splitKey(key)
            cache.set(key, new Axis2d(this, xAxis, yAxis))
          }
          return cache.get(key)
        },
        has: (_cache, key) => typeof key === 'string' && this._axis2dKeys().includes(key),
        ownKeys: () => this._axis2dKeys(),
        getOwnPropertyDescriptor: (_cache, key) =>
          typeof key === 'string' && this._axis2dKeys().includes(key)
            ? { enumerable: true, configurable: true }
            : undefined,
      })
    }
    return this._axis2dProxy
  }

  async _applyUpdate({ config, data } = {}) {
    if (config !== undefined) this.currentConfig = config
    if (data !== undefined) {
      this._rawData = normalizeData(data)
      this._lastRawDataArg = data
    }

    if (!this.currentConfig || !this._rawData) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight
    const plotWidth = width - this.margin.left - this.margin.right
    const plotHeight = height - this.margin.top - this.margin.bottom

    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.plotWidth = Math.max(1, plotWidth)
    this.plotHeight = Math.max(1, plotHeight)

    this._warnedMissingDomains = false
    await this._initialize()
    this._selectionPipeline?.resize(Math.max(1, width), Math.max(1, height))
    this._syncFloats()
  }

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
    // Emit 'axisoptions' for each axis-part key the new config changed — keyed by what
    // changed, not by who changed it (the menu is just one caller of update()). The lock
    // key is emitted here too for a config-path change; setAxisLocked() emits its own,
    // and never calls update(), so the two paths never double-fire.
    if (config !== undefined) {
      this._emitAxisOptionsDiff(previousConfig?.axes ?? {}, config.axes ?? {})
      this._emitColorbarsDiff(previousConfig?.colorbars ?? [], config.colorbars ?? [])
    }
  }

  // Compare the axis-part keys of two `axes` blocks (default-normalised) and emit one
  // 'axisoptions' event per changed slot/key. `scale` (log/linear), `colorscale`,
  // `colorbar` and `filterbar` live here too, so each emits on change like the rest.
  _emitAxisOptionsDiff(prevAxes, nextAxes) {
    const DEFAULTS = {
      visible: true, tickLabelsVisible: true, titleVisible: true, locked: false,
      scale: undefined, colorscale: undefined, colorbar: 'none', filterbar: 'none',
    }
    for (const slot of new Set([...Object.keys(prevAxes), ...Object.keys(nextAxes)])) {
      for (const [key, def] of Object.entries(DEFAULTS)) {
        const ov = prevAxes[slot]?.[key] ?? def
        const nv = nextAxes[slot]?.[key] ?? def
        if (ov !== nv) this._emitAxisOptions({ type: 'axisoptions', axis: slot, key, value: nv })
      }
    }
  }

  // 2D colour pairs live in the `colorbars` array (keyed by the ordered quantity-kind
  // pair), not in `axes`, so they get their own diff. Each changed colorscale/colorbar/
  // enabled emits an 'axisoptions' with axis:null and an axis2d key ("<qkX>__<qkY>") so
  // a pair can never be mistaken for a real slot.
  _emitColorbarsDiff(prevCB, nextCB) {
    const DEFAULTS = { colorscale: undefined, colorbar: true, enabled: true }
    const index = (arr) => {
      const m = new Map()
      for (const e of arr) {
        if (e?.xAxis != null && e?.yAxis != null) m.set(Axis2d.makeKey(e.xAxis, e.yAxis), e)
      }
      return m
    }
    const prev = index(prevCB), next = index(nextCB)
    for (const axis2d of new Set([...prev.keys(), ...next.keys()])) {
      for (const [key, def] of Object.entries(DEFAULTS)) {
        const ov = prev.get(axis2d)?.[key] ?? def
        const nv = next.get(axis2d)?.[key] ?? def
        if (ov !== nv) this._emitAxisOptions({ type: 'axisoptions', axis: null, axis2d, key, value: nv })
      }
    }
  }

  async forceUpdate() {
    await this.update({})
  }

  // The merged per-slot config for one live-scaled spatial slot: the quantity kind's
  // defaults, the stored override overlay, the live domain, and the bound quantity
  // kind. The single place the stored overlay and the runtime state are reconciled;
  // getConfig() loops it over every live slot and Axis.getConfig() returns it for one,
  // so plot.getConfig().axes[slot] deep-equals plot.axes[slot].getConfig() by construction.
  _axisConfig(slot) {
    const scale = this.axisRegistry?.getScale(slot)
    if (!scale) return { ...(this.currentConfig?.axes?.[slot] ?? {}) }
    const qk          = this.axisRegistry.getQkForSlot(slot)
    const qkDef       = qk ? getAxisQuantityKind(qk) : {}
    const initialized = qk ? this.axisRegistry.getDomain(qk) != null : false
    const [min, max]  = scale.domain()
    return {
      ...qkDef,
      ...(this.currentConfig?.axes?.[slot] ?? {}),
      ...(initialized ? { min, max } : {}),
      ...(qk ? { quantity_kind: qk } : {}),
    }
  }

  getConfig() {
    const axes = { ...(this.currentConfig?.axes ?? {}) }

    if (this.axisRegistry) {
      for (const axisId of AXES) {
        if (this.axisRegistry.getScale(axisId)) axes[axisId] = this._axisConfig(axisId)
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

    return { transforms: [], colorbars: [], ...this.currentConfig, axes }
  }

  async _initialize() {
    const epoch = ++this._initEpoch
    const { layers = [], colorbars = [], transforms = [], interactions = {} } = this.currentConfig

    // Unregister selection columns from previous layer set
    for (const layer of this.layers) {
      if (layer.selectionName) {
        globalSelectionRegistry.unregister(this._lastRawDataArg, layer.selectionName, this)
      }
    }

    // Destroy GPU buffers owned by the previous layer set before rebuilding.
    for (const layer of this.layers) {
      for (const buf of Object.values(layer._bufferProps ?? {})) {
        if (buf && typeof buf.destroy === 'function') buf.destroy()
      }
    }

    this.layers = []
    this._dataTransformNodes = []

    if (this._rawData != null) {
      const fresh = new DataGroup({})
      fresh._children = { ...this._rawData._children }
      this.currentData = fresh
    }

    this.axisRegistry = new AxisRegistry(this.plotWidth, this.plotHeight)

    this._rebuildColorscaleTexture()

    await this._processTransforms(transforms, epoch)
    if (this._initEpoch !== epoch) return
    await this._processLayers(layers, this.currentData, epoch)
    if (this._initEpoch !== epoch) return

    // Read the axes from the live config, not the one this update started with: a linked
    // axis that zoomed meanwhile has written its new range there (setAxisDomain).
    const cleanAxes = { ...(this.currentConfig.axes ?? {}) }
    for (const axisId of AXES) {
      const cfg = cleanAxes[axisId]
      if (cfg?.quantity_kind != null &&
          cfg.quantity_kind !== this.axisRegistry.getQkForSlot(axisId)) {
        delete cleanAxes[axisId]
      }
    }
    this.currentConfig = { ...this.currentConfig, axes: cleanAxes }

    this._setDomains(cleanAxes)

    this._is3D = AXES.some(a => !AXES_2D.includes(a) && this.axisRegistry.getScale(a) !== null)

    // Built before _layoutMargin() so the margin can size the tick-label and title
    // bands from the rendered font (TickLabelAtlas.measure / .lineHeight).
    if (this._tickLabelAtlas) this._tickLabelAtlas.destroy()
    this._tickLabelAtlas = new TickLabelAtlas(this.regl)

    this._layoutMargin()

    // Carry the orbit orientation across update()/_initialize so an unrelated config change
    // (e.g. an axis option from the menu) does not snap a 3D plot back to its default view.
    const prevCamera = this._camera
    this._camera = new Camera(this._is3D)
    if (prevCamera?._is3D && this._is3D) {
      this._camera._theta  = prevCamera._theta
      this._camera._phi    = prevCamera._phi
      this._camera._radius = prevCamera._radius
    }
    this._camera.resize(this.plotWidth, this.plotHeight)

    for (const entry of colorbars) {
      if (entry.enabled === false) continue
      if (!entry.colorscale || entry.colorscale == "none") continue
      if (entry.xAxis) this.axisRegistry.ensureColorAxis(entry.xAxis, entry.colorscale)
      if (entry.yAxis) this.axisRegistry.ensureColorAxis(entry.yAxis, entry.colorscale)
    }

    if (!this._zoomController) this._zoomController = new ZoomController(this)
    if (!this._axisLimitEditor) this._axisLimitEditor = new AxisLimitEditor(this)
    if (!this._axisMenu) this._axisMenu = new AxisMenu(this)

    for (const i of (this._interactions ?? [])) i.destroy()
    this._interactions = []
    if (interactions.lasso != null && interactions.lasso !== false) {
      let lassoSpecs
      if (interactions.lasso === true) {
        const selectionNames = [...new Set(
          layers.flatMap(layerSpec => Object.values(layerSpec).map(cfg => cfg.selection).filter(Boolean))
        )]
        lassoSpecs = selectionNames.map(selection => ({ selection, trigger: 'shift' }))
      } else {
        lassoSpecs = interactions.lasso
      }
      this._interactions = lassoSpecs.map(({ selection, trigger = 'shift', mode, bandWidth }) =>
        new LassoInteraction(this, {
          selectionName: selection,
          trigger,
          mode: mode ?? this._lassoMode ?? 'lasso',
          bandWidth: bandWidth ?? this._lassoBandWidth ?? null,
        })
      )
    }

    this._readyEpoch = epoch
    this.scheduleRender()
  }

  // True once the latest update() has finished building this plot's axes and layers.
  // While one is in flight, or after one failed, the axes hold d3's placeholder ranges
  // ([0, 1], or [1, 10] on a log scale), so zoom and pan must not read them: the
  // result would reach every linked axis.
  _isReady() {
    return this._readyEpoch === this._initEpoch
  }

  _rebuildColorscaleTexture() {
    const version = getColorscalesVersion()
    if (this._colorscalesVersion === version) return
    // Release old colorscale ref before acquiring the new version.
    if (this._colorscalesVersion !== undefined) {
      globalResourceRegistry.releaseOwner(this)
    }
    this._colorscalesVersion = version
    const csTexData = buildColorscaleTexture()
    if (!csTexData) return
    this.colorscaleTexture = globalResourceRegistry.acquire(
      `colorscale-v${version}`,
      () => this.regl.texture({
        width:  csTexData.width,
        height: csTexData.height,
        data:   csTexData.data,
        format: 'rgba',
        type:   'float',
        mag:    'nearest',
        min:    'nearest',
        wrapS:  'clamp',
        wrapT:  'clamp',
      }),
      this
    )
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(async () => {
          try {
            await this.forceUpdate()
          } catch (e) {
            console.error('[gladly] Error during resize-triggered update():', e)
          }
        })
      })
      this.resizeObserver.observe(this._canvas)
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

  // Called by MasterCanvas immediately before _drawSync() to keep dimensions current.
  // Also sizes the display canvas backing store so the transferred bitmap shows 1:1.
  _updateDimensions(rect) {
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (w === this.width && h === this.height) return
    this.width      = w
    this.height     = h
    this.plotWidth  = Math.max(1, w - this.margin.left - this.margin.right)
    this.plotHeight = Math.max(1, h - this.margin.top  - this.margin.bottom)
    this._canvas.width  = w
    this._canvas.height = h
  }

  // Sets this.margin side by side: the constructor's `margin` where the side draws an
  // axis, `marginWithoutAxis` where it draws none (no layer uses the axis, or it is
  // hidden with `visible: false`). A 3D plot keeps `margin` on every side.
  _layoutMargin() {
    const sideAxis = { top: 'xaxis_top', right: 'yaxis_right', bottom: 'xaxis_bottom', left: 'yaxis_left' }
    const axes = this.currentConfig.axes ?? {}
    const drawsAxis = (axisId) => this.axisRegistry.getScale(axisId) !== null && axes[axisId]?.visible !== false
    // When a side draws an axis, start from the full margin and give back the band of
    // any hidden part (the title band when titleVisible:false, the tick-label band when
    // tickLabelsVisible:false), never dropping below marginWithoutAxis for that side.
    // The band sizes come from the rendered font via the atlas, not hard-coded.
    const atlas = this._tickLabelAtlas
    const sideMargin = (side, axisId) => {
      if (this._is3D) return this._marginWithAxis[side]
      const floor = this._marginWithoutAxis[side] ?? this._marginWithAxis[side]
      if (!drawsAxis(axisId)) return floor
      let m = this._marginWithAxis[side]
      const c = axes[axisId] ?? {}
      const axis = this._getAxis(axisId)
      if (c.titleVisible === false)      m -= axis.titleBandPx(atlas)
      if (c.tickLabelsVisible === false) m -= axis.tickLabelBandPx(atlas)
      return Math.max(m, floor)
    }
    this.margin = Object.fromEntries(Object.entries(sideAxis).map(([side, axisId]) => [side, sideMargin(side, axisId)]))
    this.plotWidth  = Math.max(1, this.width  - this.margin.left - this.margin.right)
    this.plotHeight = Math.max(1, this.height - this.margin.top  - this.margin.bottom)
    this.axisRegistry.resize(this.plotWidth, this.plotHeight)
  }

  // Phase 1 — async: refresh transforms and data columns.
  // Called by MasterCanvas in parallel with other plots before any draw calls.
  async _prepareRender() {
    this._dirty = false
    this._hadError = this._hasError
    this._currentRenderHasError = false

    for (const node of this._dataTransformNodes) {
      try {
        await node.refreshIfNeeded(this)
      } catch (e) {
        this._emitError(new Error(`Transform refresh failed: ${e.message}`, { cause: e }))
      }
      await tdrYield()
    }

    this._failedLayers = new Set()
    for (const layer of this.layers) {
      for (const col of layer._dataColumns ?? []) {
        try {
          await col.refresh(this)
        } catch (e) {
          this._emitError(new Error(
            `Layer '${layer.type?.name ?? 'unknown'}' (config index ${layer.configLayerIndex}): column refresh failed: ${e.message}`,
            { cause: e }
          ))
          this._failedLayers.add(layer)
          break
        }
        await tdrYield()
      }
    }
  }

  // Subclasses (Colorbar, Filterbar, Colorbar2d) override this to pull state from
  // their target plot. Called at the start of every _drawSync(), even for non-dirty renders.
  _syncBeforeDraw() {}

  // Phase 2 — sync: draw all layers and axes into the shared offscreen at origin.
  // MasterCanvas resizes the offscreen to this plot's size, calls _drawSync(), then
  // transfers the resulting bitmap to this plot's display canvas. Because each plot
  // owns a real DOM canvas, the browser composites overlaps — no scissoring needed.
  _drawSync() {
    this._syncBeforeDraw()
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

    // Viewports are at the offscreen's origin — the offscreen is sized to this plot.
    const viewport = {
      x:      this.margin.left,
      y:      this.margin.bottom,
      width:  this.plotWidth,
      height: this.plotHeight,
    }
    const fullViewport = {
      x: 0, y: 0,
      width: this.width, height: this.height,
    }

    const cameraMvp = this._camera ? this._camera.getMVP() : mat4Identity()

    const sx = this.plotWidth  / this.width
    const sy = this.plotHeight / this.height
    const cx = (this.margin.left   - this.margin.right)  / this.width
    const cy = (this.margin.bottom - this.margin.top)    / this.height
    const Mvp = new Float32Array([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0,  0, 1, 0,
      cx, cy, 0, 1,
    ])
    const axisMvp = mat4Multiply(Mvp, cameraMvp)

    const failedLayers = this._failedLayers ?? new Set()

    // Build layer props (viewport included) once.
    const layerPropsList = this.layers.map((layer, i) => {
      const layerViewport = this._is3D ? fullViewport : viewport
      const layerMvp      = this._is3D ? axisMvp : cameraMvp
      const props = this._buildLayerProps(layer, i, { viewport: layerViewport, mvp: layerMvp })
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
      return props
    })

    // Prepare tick-label atlas once (uploads texture; must precede all render calls).
    const mc = getMasterCanvas()
    const hasAxes = mc.axisLineCmd && mc.axisBillboardCmd && this._tickLabelAtlas
    if (hasAxes) {
      for (const axisId of AXES) {
        if (!this.axisRegistry.getScale(axisId)) continue
        this._getAxis(axisId).prepareAtlas(this._tickLabelAtlas, axisMvp, this.width, this.height)
      }
      this._tickLabelAtlas.flush()
    }

    // Single clear + draw over the whole offscreen (sized to this plot).
    this.regl.clear({ color: [1, 1, 1, 1], depth: 1 })

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (!failedLayers.has(layer)) {
        try {
          layer.draw(layerPropsList[i])
        } catch (e) {
          this._emitError(new Error(
            `Layer '${layer.type?.name ?? 'unknown'}' (config index ${layer.configLayerIndex}): draw failed: ${e.message}`,
            { cause: e }
          ))
        }
      }
    }

    if (hasAxes) {
      for (const axisId of AXES) {
        if (!this.axisRegistry.getScale(axisId)) continue
        this._getAxis(axisId).render(
          this.regl, axisMvp, this.width, this.height,
          this._is3D, this._tickLabelAtlas,
          mc.axisLineCmd, mc.axisBillboardCmd,
        )
      }
    }

    for (const cb of this._renderCallbacks) cb()

    if (this._hadError && !this._currentRenderHasError) {
      this._hasError = false
      const event = { type: 'no-error' }
      for (const cb of this._noErrorListeners) {
        try { cb(event) } catch (e) { console.error('[gladly] Error in no-error listener:', e) }
      }
    }

    this._lastRenderEnd = performance.now()
  }

  _buildLayerProps(layer, layerIdx, { pickMode = 0.0, viewport = null, mvp = null } = {}) {
    const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
    const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
    const zIsLog = layer.zAxis ? this.axisRegistry.isLogScale(layer.zAxis) : false
    const zScale = layer.zAxis ? this.axisRegistry.getScale(layer.zAxis) : null
    const camMvp = this._camera ? this._camera.getMVP() : mat4Identity()

    const resolvedMvp = mvp ?? camMvp
    const resolvedViewport = viewport ?? {
      x: this.margin.left,
      y: this.margin.bottom,
      width: this.plotWidth,
      height: this.plotHeight,
    }

    const props = {
      xDomain: layer.xAxis ? (this.axisRegistry.getScale(layer.xAxis)?.domain() ?? [0, 1]) : [0, 1],
      yDomain: layer.yAxis ? (this.axisRegistry.getScale(layer.yAxis)?.domain() ?? [0, 1]) : [0, 1],
      zDomain: zScale ? zScale.domain() : [0, 1],
      xScaleType: xIsLog ? 1.0 : 0.0,
      yScaleType: yIsLog ? 1.0 : 0.0,
      zScaleType: zIsLog ? 1.0 : 0.0,
      u_is3D:    this._is3D ? 1.0 : 0.0,
      u_mvp:     resolvedMvp,
      viewport:  resolvedViewport,
      count: layer.vertexCount
        ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length
        ?? Object.values(layer.attributes).find(v => Array.isArray(v) && v.length > 0 && v[0] instanceof Float32Array)?.[0]?.length
        ?? 0,
      u_pickingMode:    pickMode,
      u_pickLayerIndex: layerIdx,
      u_mode:             0.0,
      u_capture_tex_size: [0, 0],
      u_capture_endpoint: 0.0,
    }

    if (layer.instanceCount !== null) {
      props.instances = layer.instanceCount
    }

    for (const qk of Object.values(layer.colorAxes)) {
      const pk = qk.replace(/\./g, '_')
      props[`colorscale_${pk}`]        = this.axisRegistry.getColorscaleIndex(qk)
      const domain = this.axisRegistry.getDomain(qk)
      props[`color_range_${pk}`]       = domain ?? [0, 1]
      props[`color_scale_type_${pk}`]  = this._getScaleTypeFloat(qk)
      props[`alpha_blend_${pk}`]       = this.axisRegistry.getAlphaBlend(qk)
      props[`color_filter_range_${pk}`]= this.axisRegistry.getColorFilterRangeUniform(qk)
    }

    for (const qk of Object.values(layer.filterAxes)) {
      const pk = qk.replace(/\./g, '_')
      props[`filter_range_${pk}`]      = this.axisRegistry.getFilterRangeUniform(qk)
      props[`filter_scale_type_${pk}`] = this._getScaleTypeFloat(qk)
    }

    return props
  }

  getAxisQuantityKind(axisId) {
    if (Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, axisId)) {
      return this.axisRegistry ? this.axisRegistry.getQkForSlot(axisId) : null
    }
    return axisId
  }

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

  setAxisDomain(axisId, domain) {
    if (Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, axisId)) {
      const qk = this.axisRegistry?.getQkForSlot(axisId)
      if (qk) {
        this.axisRegistry.setDomain(qk, domain)
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

  // ─── Range lock (local to this plot) ────────────────────────────────────────
  //
  // The lock is a per-slot `locked` key in axes.<slot>. It never propagates across
  // linkAxes and never consults another plot. The only grouping it honours is within
  // this plot: slots sharing a quantity kind are one axis to the user, so they share a
  // lock. The stored truth is the `locked` key; these are derived read / config write.

  // True when `slot` holds the lock, or when another slot of THIS plot with the same
  // quantity kind holds it. Does not follow linked axes.
  isAxisLocked(slot) {
    const axes = this.currentConfig?.axes ?? {}
    if (axes[slot]?.locked) return true
    const qk = this.axisRegistry?.getQkForSlot(slot)
    if (qk == null) return false
    for (const other of AXES) {
      if (other !== slot && axes[other]?.locked && this.axisRegistry.getQkForSlot(other) === qk) return true
    }
    return false
  }

  // Writes `locked` into axes.<slot> — set on the slot when turning on; cleared on the
  // slot and every same-QK sibling of this plot when turning off — then renders again
  // without update() (no layer rebuild). Touches only this plot's config.
  setAxisLocked(slot, on) {
    const config = this.currentConfig ?? {}
    const axes = { ...(config.axes ?? {}) }
    const clear = (s) => {
      if (axes[s]?.locked) { const c = { ...axes[s] }; delete c.locked; axes[s] = c }
    }
    if (on) {
      axes[slot] = { ...(axes[slot] ?? {}), locked: true }
    } else {
      const qk = this.axisRegistry?.getQkForSlot(slot)
      clear(slot)
      if (qk != null) {
        for (const s of AXES) {
          if (s !== slot && this.axisRegistry.getQkForSlot(s) === qk) clear(s)
        }
      }
    }
    this.currentConfig = { ...config, axes }
    this.scheduleRender()
    this._emitAxisOptions({ type: 'axisoptions', axis: slot, key: 'locked', value: !!on })
  }

  // Reset the 2D spatial axes to their data range. Color/filter axes and locked axes
  // are left alone; a 3D plot does nothing (reset stays 2D-only).
  resetAxes() {
    if (this._is3D || !this.axisRegistry) return
    for (const axisId of AXES_2D) {
      if (!this.axisRegistry.getScale(axisId)) continue
      if (this.isAxisLocked(axisId)) continue
      this._getAxis(axisId).setDomain(null)
    }
  }

  _syncFloats() {
    const config = this.currentConfig ?? {}
    const axes = config.axes ?? {}
    const colorbarsConfig = config.colorbars ?? []
    const desired = new Map()

    for (const [axisName, axisConfig] of Object.entries(axes)) {
      if (AXES.includes(axisName)) continue
      const cb = axisConfig.colorbar
      if (cb === "vertical" || cb === "horizontal") {
        const tag = `colorbar:${axisName}:${cb}`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName, orientation: cb }, y: 10 })
      }
      if (this.axisRegistry?.hasFilterAxis(axisName)) {
        const fb = axisConfig.filterbar
        if (fb === "vertical" || fb === "horizontal") {
          const tag = `filterbar:${axisName}:${fb}`
          const factoryDef = Plot._floatFactories.get('filterbar')
          if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName, orientation: fb }, y: 100 })
        }
      }
    }

    for (const entry of colorbarsConfig) {
      if (entry.colorbar === false) continue
      const { xAxis, yAxis } = entry
      if (xAxis && yAxis) {
        const tag = `colorbar2d:${xAxis}:${yAxis}`
        const factoryDef = Plot._floatFactories.get('colorbar2d')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { xAxis, yAxis }, y: 10 })
      } else if (xAxis) {
        const tag = `colorbar:${xAxis}:horizontal`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName: xAxis, orientation: 'horizontal' }, y: 10 })
      } else if (yAxis) {
        const tag = `colorbar:${yAxis}:vertical`
        const factoryDef = Plot._floatFactories.get('colorbar')
        if (factoryDef) desired.set(tag, { factoryDef, opts: { axisName: yAxis, orientation: 'vertical' }, y: 10 })
      }
    }

    for (const [tag, float] of this._floats) {
      if (!desired.has(tag)) {
        float.destroy()
        this._floats.delete(tag)
      }
    }

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
    getMasterCanvas().unregister(this)
    globalResourceRegistry.releaseOwner(this)

    for (const float of this._floats.values()) {
      float.destroy()
    }
    this._floats.clear()

    for (const axis of this._axisCache.values()) {
      axis._listeners.clear()
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    } else if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler)
    }

    if (this._tickLabelAtlas) {
      this._tickLabelAtlas.destroy()
      this._tickLabelAtlas = null
    }

    this._shaderCache.clear()

    for (const i of (this._interactions ?? [])) i.destroy()
    this._interactions = []

    this._axisLimitEditor?.destroy()
    this._axisLimitEditor = null
    this._axisLimitListeners.clear()

    this._axisMenu?.destroy()
    this._axisMenu = null
    this._axisOptionsListeners.clear()
    this._contextMenuListeners.clear()
    this._contextMenuOpenListeners.clear()

    this._renderCallbacks.clear()
    this._canvas.remove()
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

      const ac = layerType.resolveAxisConfig(parameters, data)
      const axesConfig = this.currentConfig?.axes ?? {}

      if (ac.xAxis && ac.xAxisQuantityKind != null) this.axisRegistry.ensureSpatialSlot(ac.xAxis, ac.xAxisQuantityKind, axesConfig[ac.xAxis]?.scale ?? axesConfig[ac.xAxisQuantityKind]?.scale)
      if (ac.yAxis && ac.yAxisQuantityKind != null) this.axisRegistry.ensureSpatialSlot(ac.yAxis, ac.yAxisQuantityKind, axesConfig[ac.yAxis]?.scale ?? axesConfig[ac.yAxisQuantityKind]?.scale)
      if (ac.zAxis && ac.zAxisQuantityKind != null) this.axisRegistry.ensureSpatialSlot(ac.zAxis, ac.zAxisQuantityKind, axesConfig[ac.zAxis]?.scale ?? axesConfig[ac.zAxisQuantityKind]?.scale)

      for (const quantityKind of Object.values(ac.colorAxisQuantityKinds)) {
        this.axisRegistry.ensureColorAxis(quantityKind)
      }
      for (const quantityKind of Object.values(ac.filterAxisQuantityKinds)) {
        this.axisRegistry.ensureFilterAxis(quantityKind)
      }

      let gpuLayers
      try {
        gpuLayers = await layerType.createLayer(this.regl, parameters, data, this)
      } catch (e) {
        this._emitError(new Error(`Layer '${layerTypeName}' (index ${configLayerIndex}) failed to create: ${e.message}`, { cause: e }))
        continue
      }
      if (this._initEpoch !== epoch) return
      for (const layer of gpuLayers) {
        const selectionName = parameters.selection || null
        if (selectionName && this._lastRawDataArg != null) {
          const N = layer.instanceCount ?? layer.vertexCount ?? 0
          const selCol = globalSelectionRegistry.register(
            this._lastRawDataArg,
            selectionName,
            this,
            this.regl,
            N > 0 ? [N] : []
          )
          layer.selectionName   = selectionName
          layer.selectionColumn = selCol
        }

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
    const drawConfigRaw = await layer.type.createDrawCommand(this.regl, layer, this)

    if (typeof drawConfigRaw === 'function') return drawConfigRaw

    const captureConfigRaw = drawConfigRaw._captureConfig ?? null
    if (captureConfigRaw) delete drawConfigRaw._captureConfig
    if (captureConfigRaw?._captureConfig) delete captureConfigRaw._captureConfig

    const drawConfig = drawConfigRaw

    const isTiledTexClosure = (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'function'
    const isTiledBuffer = (v) => Array.isArray(v) && v.length > 0 && v[0] instanceof Float32Array

    const compileConfig = (config) => {
      const shaderKey = config.vert + '\0' + config.frag
      if (!this._shaderCache.has(shaderKey)) {
        const propAttrs = {}
        for (const [key, val] of Object.entries(config.attributes)) {
          if (isTiledBuffer(val)) {
            propAttrs[key] = this.regl.prop(`attr_${key}`)
          } else {
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
        }
        const propUniforms = {}
        for (const [key, val] of Object.entries(config.uniforms)) {
          propUniforms[key] = (typeof val === 'function' || isTiledTexClosure(val))
            ? this.regl.prop(key) : val
        }
        this._shaderCache.set(shaderKey, enqueueRegl(this.regl, { ...config, attributes: propAttrs, uniforms: propUniforms }))
      }
      const cmd = this._shaderCache.get(shaderKey)

      const tiledClosures = {}
      const dynamicUniforms = {}
      for (const [key, val] of Object.entries(config.uniforms)) {
        if (isTiledTexClosure(val)) tiledClosures[key] = val
        else if (typeof val === 'function') dynamicUniforms[key] = val
      }

      const pickAttrVal = config.attributes['a_pickId']
      const pickBuf = pickAttrVal?.buffer instanceof Float32Array ? pickAttrVal.buffer
        : pickAttrVal instanceof Float32Array ? pickAttrVal : null
      const pickCountPerTile = pickBuf?.length ?? 0

      let typedArrayPickOffsets = null
      for (const [, val] of Object.entries(config.attributes)) {
        if (isTiledBuffer(val)) {
          let offset = 0
          typedArrayPickOffsets = val.map(arr => { const o = offset; offset += arr.length; return o })
          break
        }
      }

      return (runtimeProps) => {
        const baseProps = {}
        for (const [key, fn] of Object.entries(dynamicUniforms)) baseProps[key] = fn()
        let nTiles = 1
        for (const fns of Object.values(tiledClosures)) {
          if (fns.length > nTiles) nTiles = fns.length
        }
        for (const bufs of Object.values(tiledGpuBuffers)) {
          if (bufs.length > nTiles) nTiles = bufs.length
        }
        layer._tilePickOffsets = Array.from({ length: nTiles }, (_, t) =>
          typedArrayPickOffsets ? (typedArrayPickOffsets[t] ?? 0) : t * pickCountPerTile
        )
        layer._tileSizes = Array.from({ length: nTiles }, (_, t) =>
          tiledBufferCounts.length > 0 ? tiledBufferCounts[t] : pickCountPerTile
        )
        layer._totalPickCount = typedArrayPickOffsets
          ? (typedArrayPickOffsets[nTiles - 1] ?? 0) + (tiledBufferCounts[nTiles - 1] ?? pickCountPerTile)
          : nTiles * pickCountPerTile

        const selCol = layer.selectionColumn
        if (selCol && layer._tileSizes.every(n => n > 0)) {
          const currentSizes = selCol._tiles.map(t => t.n)
          if (!arraysEqual(currentSizes, layer._tileSizes)) {
            selCol._rebuild(layer._tileSizes)
          }
        }

        const tileOnly          = runtimeProps._tileOnly
        const captureTileOffset = runtimeProps._captureTileOffset

        for (let t = 0; t < nTiles; t++) {
          if (tileOnly !== undefined && tileOnly !== t) continue
          const tileProps = {}
          let skip = false
          for (const [key, fns] of Object.entries(tiledClosures)) {
            const tex = (t < fns.length ? fns[t] : fns[0])?.()
            if (tex == null) { skip = true; break }
            tileProps[key] = tex
          }
          if (skip) continue
          for (const [propKey, bufs] of Object.entries(tiledGpuBuffers)) {
            tileProps[propKey] = bufs[t < bufs.length ? t : 0]
          }
          tileProps['u_tile_pick_offset'] = captureTileOffset !== undefined
            ? captureTileOffset
            : (typedArrayPickOffsets ? (typedArrayPickOffsets[t] ?? 0) : t * pickCountPerTile)
          const tileCount = tiledBufferCounts.length > 0 ? tiledBufferCounts[t] : null
          cmd({ ...bufferProps, ...baseProps, ...tileProps, ...runtimeProps, ...(tileCount !== null ? { count: tileCount } : {}) })
        }
      }
    }

    const bufferProps = {}
    const tiledGpuBuffers = {}
    const tiledBufferCounts = []
    for (const [key, val] of Object.entries(drawConfig.attributes)) {
      if (isTiledBuffer(val)) {
        tiledGpuBuffers[`attr_${key}`] = val.map(arr => this.regl.buffer(arr))
        if (tiledBufferCounts.length === 0) val.forEach(arr => tiledBufferCounts.push(arr.length))
        continue
      }
      const rawBuf = val?.buffer instanceof Float32Array ? val.buffer
        : val instanceof Float32Array ? val : null
      if (rawBuf !== null) {
        bufferProps[`attr_${key}`] = this.regl.buffer(rawBuf)
      }
    }

    layer._bufferProps = bufferProps

    const drawFn = compileConfig(drawConfig)

    if (captureConfigRaw) {
      const rawCaptureFn = compileConfig(captureConfigRaw)
      if (layer.instanceCount !== null && 'attr_a_endPoint' in bufferProps) {
        const capBuf0 = this.regl.buffer(new Float32Array([0.0]))
        const capBuf1 = this.regl.buffer(new Float32Array([1.0]))
        layer.captureDrawCmd = (props) => {
          const ep = props.u_capture_endpoint ?? 0
          rawCaptureFn({ ...props, count: 1, attr_a_endPoint: ep < 0.5 ? capBuf0 : capBuf1 })
        }
      } else {
        layer.captureDrawCmd = rawCaptureFn
      }
    }

    return drawFn
  }

  _setDomains(axesOverrides) {
    this.axisRegistry.applyAutoDomainsFromLayers(this.layers, axesOverrides)
  }

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

  // Tell 'axislimit' listeners that an axis end was typed (AxisLimitEditor, and the
  // color and filter bar floats relaying their own on this plot).
  _emitAxisLimit(event) {
    for (const cb of this._axisLimitListeners) {
      try { cb(event) } catch (e) { console.error('[gladly] Error in axislimit listener:', e) }
    }
  }

  // Tell 'axisoptions' listeners that an axis-part key (visible / tickLabelsVisible /
  // titleVisible / locked) was written — by the menu, a direct update({config}), or
  // setAxisLocked(). Keyed by what changed, not who changed it, like _emitAxisLimit.
  _emitAxisOptions(event) {
    for (const cb of this._axisOptionsListeners) {
      try { cb(event) } catch (e) { console.error('[gladly] Error in axisoptions listener:', e) }
    }
  }

  // Fire the synthetic 'contextmenu' event for a right press+release gladly did not use,
  // then open the built-in menu for the region (full or single-axis) when its gate is on.
  // `region` is ZoomController._getRegion()'s { type, axes } for an axis strip or the plot
  // area, or null for a corner / empty margin.
  _emitContextMenu(e, region) {
    const rect = this.container.getBoundingClientRect()
    const coords = this.lookup(e.clientX - rect.left, e.clientY - rect.top)
    for (const cb of this._contextMenuListeners) {
      try { cb(e, coords, region) } catch (err) { console.error('[gladly] Error in contextmenu listener:', err) }
    }
    const onAxis = region?.type === 'axis'
    const gated = onAxis ? (this.currentConfig?.axis_menu !== false) : (this.currentConfig?.plot_menu !== false)
    // The menu is viewport-positioned (attached to document.body) so it escapes any float's
    // clip and stacking context — pass the event's own viewport coordinates.
    if (gated && this._axisMenu) this._axisMenu.open(e, coords, region)
  }

  // Fire every 'contextmenu_open' listener with the built-in menu's root element, just
  // after it is built/refreshed and before it is placed (see AxisMenu.open). Mirrors
  // 'contextmenu''s (e, coords, region) and appends the menu element; errors are isolated.
  _emitContextMenuOpen(e, coords, region, menuEl) {
    for (const cb of this._contextMenuOpenListeners) {
      try { cb(e, coords, region, menuEl) }
      catch (err) { console.error('[gladly] Error in contextmenu_open listener:', err) }
    }
  }

  scheduleRender(sourcePlot = null) {
    if (!this.regl) return
    this._dirty = true
    if (sourcePlot) this._pendingSourcePlot = sourcePlot
    if (this._throttleTimerId !== null) return

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
    this._pendingSourcePlot = null
    getMasterCanvas().schedulePlotRender(this)
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
    if (eventType === 'axislimit') {
      this._axisLimitListeners.add(callback)
      return { remove: () => this._axisLimitListeners.delete(callback) }
    }
    if (eventType === 'axisoptions') {
      this._axisOptionsListeners.add(callback)
      return { remove: () => this._axisOptionsListeners.delete(callback) }
    }
    // 'contextmenu' is synthetic: a right press+release gladly did not use (see
    // ZoomController / _emitContextMenu), not the raw DOM event. cb(e, coords, region).
    if (eventType === 'contextmenu') {
      this._contextMenuListeners.add(callback)
      return { remove: () => this._contextMenuListeners.delete(callback) }
    }
    // 'contextmenu_open' is synthetic: fired from AxisMenu.open with the built-in menu's
    // root element so a listener can augment it. cb(e, coords, region, menuEl); its first
    // three args mirror 'contextmenu'.
    if (eventType === 'contextmenu_open') {
      this._contextMenuOpenListeners.add(callback)
      return { remove: () => this._contextMenuOpenListeners.delete(callback) }
    }
    const handler = (e) => {
      if (!this.container.contains(e.target)) return
      // Events on gladly's own controls (the axis limit boxes) are not plot events.
      if (e.target.closest?.('[data-gladly-control]')) return
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

    // Ensure dimensions are current before picking.
    const rect = this._canvas.getBoundingClientRect()
    this._updateDimensions(rect)

    const glX = Math.round(x)
    const glY = this.height - Math.round(y) - 1

    if (glX < 0 || glX >= this.width || glY < 0 || glY >= this.height) return null

    const fbo = this.regl.framebuffer({
      width: this.width, height: this.height,
      colorFormat: 'rgba', colorType: 'uint8', depth: false, stencil: false,
    })

    for (const node of this._dataTransformNodes) {
      await node.refreshIfNeeded(this)
    }
    for (const layer of this.layers) {
      for (const col of layer._dataColumns ?? []) await col.refresh(this)
    }

    let result = null
    try {
      this.regl({ framebuffer: fbo })(() => {
        this.regl.clear({ color: [0, 0, 0, 0] })
        for (let i = 0; i < this.layers.length; i++) {
          const layer = this.layers[i]
          const props = this._buildLayerProps(layer, i, { pickMode: 1.0 })
          layer.draw(props)
        }
        var pixels
        try {
          pixels = this.regl.read({ x: glX, y: glY, width: 1, height: 1 })
        } catch (e) {
          pixels = [0]
        }
        if (pixels[0] === 0) {
          result = null
        } else {
          const layerIndex = pixels[0] - 1
          const dataIndex = (pixels[1] << 16) | (pixels[2] << 8) | pixels[3]
          const layer = this.layers[layerIndex]
          const offsets = layer._tilePickOffsets ?? [0]
          let tile = 0
          for (let t = offsets.length - 1; t >= 0; t--) {
            if (offsets[t] <= dataIndex) { tile = t; break }
          }
          const index = dataIndex - offsets[tile]
          result = { layerIndex, configLayerIndex: layer.configLayerIndex, tile, index, layer }
        }
      })
    } finally {
      fbo.destroy()
    }
    return result
  }

  // Change the selection shape of every lasso interaction at run time, without update().
  // Kept on the plot, so interactions a later update() builds start in it too.
  setLassoMode(mode, { bandWidth } = {}) {
    if (!LASSO_MODES.includes(mode))
      throw new Error(`Unknown lasso mode '${mode}'; expected one of ${LASSO_MODES.join(', ')}`)
    this._lassoMode = mode
    if (bandWidth !== undefined) this._lassoBandWidth = bandWidth
    for (const i of (this._interactions ?? [])) {
      i.setMode(mode)
      if (bandWidth !== undefined) i.setBandWidth(bandWidth)
    }
  }

  async selectLasso(vertices) {
    if (!this.regl || !this.layers.length || !this._lastRawDataArg) return

    const selectionColumns = new Map()
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (layer.selectionName && layer.selectionColumn) {
        selectionColumns.set(i, layer.selectionColumn)
      }
    }
    if (selectionColumns.size === 0) return

    if (!this._selectionPipeline) {
      this._selectionPipeline = new SelectionPipeline(this.regl, this)
    }

    await this._selectionPipeline.runLasso(vertices, selectionColumns)

    const notified = new Set()
    for (const layer of this.layers) {
      if (layer.selectionName && layer.selectionColumn && !notified.has(layer.selectionName)) {
        notified.add(layer.selectionName)
        this._getSelection(layer.selectionName)._readbackAndNotify()
      }
    }
  }
}
