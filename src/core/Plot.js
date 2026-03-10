import * as d3 from "d3-selection"
import { AXES, AxisRegistry } from "../axes/AxisRegistry.js"
import { ColorAxisRegistry } from "../axes/ColorAxisRegistry.js"
import { FilterAxisRegistry } from "../axes/FilterAxisRegistry.js"
import { ZoomController } from "../axes/ZoomController.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityKind, getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { getRegisteredColorscales, getRegistered2DColorscales } from "../colorscales/ColorscaleRegistry.js"
import { Float } from "../floats/Float.js"
import { computationSchema, buildTransformSchema, getComputedData } from "../compute/ComputationRegistry.js"
import { DataGroup, normalizeData } from "../data/Data.js"
import { enqueueRegl, compileEnqueuedShaders } from "./ShaderQueue.js"
import { GlBase } from "./GlBase.js"

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
        properties: {
          xaxis_bottom: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              label: { type: "string" },
              scale: { type: "string", enum: ["linear", "log"] },
              rotate: { type: "boolean" }
            }
          },
          xaxis_top: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              label: { type: "string" },
              scale: { type: "string", enum: ["linear", "log"] },
              rotate: { type: "boolean" }
            }
          },
          yaxis_left: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              label: { type: "string" },
              scale: { type: "string", enum: ["linear", "log"] }
            }
          },
          yaxis_right: {
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              label: { type: "string" },
              scale: { type: "string", enum: ["linear", "log"] }
            }
          }
        },
        additionalProperties: {
          // Color/filter/quantity-kind axes.
          // All fields from the quantity kind registration are valid here and override the registration.
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
            label: { type: "string" },
            scale: { type: "string", enum: ["linear", "log"] },
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
    this.canvas.style.zIndex = '1'
    container.appendChild(this.canvas)

    // Create SVG element
    this.svg = d3.select(container)
      .append('svg')
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0')
      .style('z-index', '2')
      .style('user-select', 'none')

    this.currentConfig = null
    this.layers = []
    this.axisRegistry = null
    this.colorAxisRegistry = null
    this._renderCallbacks = new Set()
    this._zoomEndCallbacks = new Set()
    this._dirty = false
    this._rafId = null

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
  _applyUpdate({ config, data } = {}) {
    if (config !== undefined) this.currentConfig = config
    if (data !== undefined) {
      this._rawData = normalizeData(data)  // normalise once; kept immutable
    }

    if (!this.currentConfig || !this._rawData) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight
    const plotWidth = width - this.margin.left - this.margin.right
    const plotHeight = height - this.margin.top - this.margin.bottom

    // Container is hidden, not yet laid out, or too small to fit the margins.
    // Store config/data and return; ResizeObserver will call forceUpdate() once
    // the container gets real dimensions.
    if (width === 0 || height === 0 || plotWidth <= 0 || plotHeight <= 0) return

    this.canvas.width = width
    this.canvas.height = height
    this.svg.attr('width', width).attr('height', height)

    this.width = width
    this.height = height
    this.plotWidth = plotWidth
    this.plotHeight = plotHeight

    this.svg.selectAll('*').remove()

    this._warnedMissingDomains = false
    this._initialize()
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

  update({ config, data } = {}) {
    const previousConfig = this.currentConfig
    const previousRawData = this._rawData
    try {
      this._applyUpdate({ config, data })
      this._validateLinks()
    } catch (error) {
      this.currentConfig = previousConfig
      this._rawData = previousRawData
      throw error
    }
  }

  forceUpdate() {
    this.update({})
  }

  getConfig() {
    const axes = { ...(this.currentConfig?.axes ?? {}) }

    if (this.axisRegistry) {
      for (const axisId of AXES) {
        const scale = this.axisRegistry.getScale(axisId)
        if (scale) {
          const [min, max] = scale.domain()
          const qk = this.axisRegistry.axisQuantityKinds[axisId]
          const qkDef = qk ? getAxisQuantityKind(qk) : {}
          axes[axisId] = { ...qkDef, ...(axes[axisId] ?? {}), min, max }
        }
      }
    }

    if (this.colorAxisRegistry) {
      for (const quantityKind of this.colorAxisRegistry.getQuantityKinds()) {
        const range = this.colorAxisRegistry.getRange(quantityKind)
        const qkDef = getAxisQuantityKind(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
          colorbar: "none",
          ...qkDef,
          ...existing,
          ...(range ? { min: range[0], max: range[1] } : {}),
        }
      }
    }

    if (this.filterAxisRegistry) {
      for (const quantityKind of this.filterAxisRegistry.getQuantityKinds()) {
        const range = this.filterAxisRegistry.getRange(quantityKind)
        const qkDef = getAxisQuantityKind(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
          filterbar: "none",
          ...qkDef,
          ...existing,
          ...(range && range.min !== null ? { min: range.min } : {}),
          ...(range && range.max !== null ? { max: range.max } : {})
        }
      }
    }

    return { transforms: [], colorbars: [], ...this.currentConfig, axes}
  }

  _initialize() {
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

    AXES.forEach(a => this.svg.append("g").attr("class", a))

    this.axisRegistry = new AxisRegistry(this.plotWidth, this.plotHeight)
    this.colorAxisRegistry = new ColorAxisRegistry()
    this.filterAxisRegistry = new FilterAxisRegistry()

    this._processTransforms(transforms)
    this._processLayers(layers, this.currentData)
    this._setDomains(axes)

    // Apply colorscale overrides from top-level colorbars entries. These override any
    // per-axis colorscale from config.axes or quantity kind registry. Applying after
    // _setDomains ensures they take effect last. For 2D colorbars both axes receive the
    // same colorscale name, which resolves to a negative index in the shader, triggering
    // the true-2D colorscale path in map_color_s_2d.
    for (const entry of colorbars) {
      if (!entry.colorscale || entry.colorscale == "none") continue
      console.log("FROM colorbars");
      if (entry.xAxis) this.colorAxisRegistry.ensureColorAxis(entry.xAxis, entry.colorscale)
      if (entry.yAxis) this.colorAxisRegistry.ensureColorAxis(entry.yAxis, entry.colorscale)
    }

    new ZoomController(this)
    this.render()
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // Defer to next animation frame so the ResizeObserver callback exits
        // before any DOM/layout changes happen, avoiding the "loop completed
        // with undelivered notifications" browser error.
        requestAnimationFrame(() => {
          try {
            this.forceUpdate()
          } catch (e) {
            console.error('[gladly] Error during resize-triggered update():', e)
          }
        })
      })
      this.resizeObserver.observe(this.container)
    } else {
      this._resizeHandler = () => {
        try {
          this.forceUpdate()
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
    if (AXES.includes(axisId)) {
      return this.axisRegistry ? this.axisRegistry.axisQuantityKinds[axisId] : null
    }
    return axisId
  }

  // Unified domain getter for spatial, color, and filter axes.
  getAxisDomain(axisId) {
    if (AXES.includes(axisId)) {
      const scale = this.axisRegistry?.getScale(axisId)
      return scale ? scale.domain() : null
    }
    if (this.colorAxisRegistry?.hasAxis(axisId)) {
      return this.colorAxisRegistry.getRange(axisId)
    }
    const filterRange = this.filterAxisRegistry?.getRange(axisId)
    if (filterRange) return [filterRange.min, filterRange.max]
    return null
  }

  // Unified domain setter for spatial, color, and filter axes.
  setAxisDomain(axisId, domain) {
    if (AXES.includes(axisId)) {
      const scale = this.axisRegistry?.getScale(axisId)
      if (scale) scale.domain(domain)
    } else if (this.colorAxisRegistry?.hasAxis(axisId)) {
      this.colorAxisRegistry.setRange(axisId, domain[0], domain[1])
    } else if (this.filterAxisRegistry?.hasAxis(axisId)) {
      this.filterAxisRegistry.setRange(axisId, domain[0], domain[1])
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
      if (this.filterAxisRegistry?.hasAxis(axisName)) {
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

    this._shaderCache.clear()

    if (this.regl) {
      this.regl.destroy()
      this.regl = null
    }

    this._renderCallbacks.clear()
    this.canvas.remove()
    this.svg.remove()
  }

  _processLayers(layersConfig, data) {
    for (let configLayerIndex = 0; configLayerIndex < layersConfig.length; configLayerIndex++) {
      const layerSpec = layersConfig[configLayerIndex]
      const entries = Object.entries(layerSpec)
      if (entries.length !== 1) {
        throw new Error("Each layer specification must have exactly one layer type key")
      }

      const [layerTypeName, parameters] = entries[0]
      const layerType = getLayerType(layerTypeName)
      if (!layerType) throw new Error(`Unknown layer type '${layerTypeName}'`)

      // Resolve axis config once per layer spec for registration (independent of draw call count).
      const ac = layerType.resolveAxisConfig(parameters, data)
      const axesConfig = this.currentConfig?.axes ?? {}

      // Register spatial axes (null means no axis for that direction).
      // Pass any scale override from config (e.g. "log") so the D3 scale is created correctly.
      if (ac.xAxis) this.axisRegistry.ensureAxis(ac.xAxis, ac.xAxisQuantityKind, axesConfig[ac.xAxis]?.scale ?? axesConfig[ac.xAxisQuantityKind]?.scale)
      if (ac.yAxis) this.axisRegistry.ensureAxis(ac.yAxis, ac.yAxisQuantityKind, axesConfig[ac.yAxis]?.scale ?? axesConfig[ac.yAxisQuantityKind]?.scale)

      // Register color axes (colorscale comes from config or quantity kind registry, not from here)
      for (const quantityKind of Object.values(ac.colorAxisQuantityKinds)) {
        this.colorAxisRegistry.ensureColorAxis(quantityKind)
      }

      // Register filter axes
      for (const quantityKind of Object.values(ac.filterAxisQuantityKinds)) {
        this.filterAxisRegistry.ensureFilterAxis(quantityKind)
      }

      // Create one draw command per GPU config returned by the layer type.
      let gpuLayers
      try {
        gpuLayers = layerType.createLayer(this.regl, parameters, data, this)
      } catch (e) {
        throw new Error(`Layer '${layerTypeName}' (index ${configLayerIndex}) failed to create: ${e.message}`, { cause: e })
      }
      for (const layer of gpuLayers) {
        layer.configLayerIndex = configLayerIndex
        try {
          layer.draw = this._compileLayerDraw(layer)
        } catch (e) {
          throw new Error(`Layer '${layerTypeName}' (index ${configLayerIndex}) failed to build draw command: ${e.message}`, { cause: e })
        }
        this.layers.push(layer)
      }
    }
    compileEnqueuedShaders(this.regl)
  }

  _compileLayerDraw(layer) {
    const drawConfig = layer.type.createDrawCommand(this.regl, layer, this)

    // Layer types that fully override createDrawCommand (e.g. TileLayer) return
    // a ready-to-call function instead of a plain drawConfig object. Pass through.
    if (typeof drawConfig === 'function') return drawConfig

    const shaderKey = drawConfig.vert + '\0' + drawConfig.frag

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
        propUniforms[key] = typeof val === 'function' ? this.regl.prop(key) : val
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

    const textureClosures = {}
    for (const [key, val] of Object.entries(drawConfig.uniforms)) {
      if (typeof val === 'function') textureClosures[key] = val
    }

    layer._bufferProps = bufferProps
    layer._textureClosures = textureClosures

    return (runtimeProps) => {
      // Resolve texture closures at draw time so live texture swaps are picked up.
      const textureProps = {}
      for (const [key, fn] of Object.entries(textureClosures)) {
        textureProps[key] = fn()
      }
      cmd({ ...bufferProps, ...textureProps, ...runtimeProps })
    }
  }

  _setDomains(axesOverrides) {
    this.axisRegistry.applyAutoDomainsFromLayers(this.layers, axesOverrides)
    this.colorAxisRegistry.applyAutoDomainsFromLayers(this.layers, axesOverrides)
    this.filterAxisRegistry.applyAutoDomainsFromLayers(this.layers, axesOverrides)
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

  scheduleRender() {
    this._dirty = true
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null
        if (this._dirty) {
          this._dirty = false
          try {
            this.render()
          } catch (e) {
            console.error('[gladly] Error during render():', e)
          }
        }
      })
    }
  }

  render() {
    this._dirty = false
    this.regl.clear({ color: [1,1,1,1], depth:1 })

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

    // Refresh transform nodes before drawing (recomputes if tracked axis domains changed)
    for (const node of this._dataTransformNodes) {
      try {
        node.refreshIfNeeded(this)
      } catch (e) {
        throw new Error(`Transform refresh failed: ${e.message}`, { cause: e })
      }
    }

    for (const layer of this.layers) {
      for (const col of layer._dataColumns ?? []) col.refresh(this)

      const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
      const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
      const props = {
        xDomain: layer.xAxis ? (this.axisRegistry.getScale(layer.xAxis)?.domain() ?? [0, 1]) : [0, 1],
        yDomain: layer.yAxis ? (this.axisRegistry.getScale(layer.yAxis)?.domain() ?? [0, 1]) : [0, 1],
        xScaleType: xIsLog ? 1.0 : 0.0,
        yScaleType: yIsLog ? 1.0 : 0.0,
        viewport: viewport,
        count: layer.vertexCount ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length ?? 0,
        u_pickingMode: 0.0,
        u_pickLayerIndex: 0.0,
      }

      if (layer.instanceCount !== null) {
        props.instances = layer.instanceCount
      }

      // Warn once if this draw call will produce no geometry
      if (!layer._warnedZeroCount) {
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
        props[`colorscale_${qk}`] = this.colorAxisRegistry.getColorscaleIndex(qk)
        const range = this.colorAxisRegistry.getRange(qk)
        props[`color_range_${qk}`] = range ?? [0, 1]
        props[`color_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
        props[`alpha_blend_${qk}`] = this.colorAxisRegistry.getAlphaBlend(qk)
      }

      for (const qk of Object.values(layer.filterAxes)) {
        props[`filter_range_${qk}`] = this.filterAxisRegistry.getRangeUniform(qk)
        props[`filter_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
      }

      layer.draw(props)
    }

    for (const axisId of AXES) this._getAxis(axisId).render()
    for (const cb of this._renderCallbacks) cb()
  }

  lookup(x, y) {
    const result = {}
    if (!this.axisRegistry) return result
    const plotX = x - this.margin.left
    const plotY = y - this.margin.top
    for (const axisId of AXES) {
      const scale = this.axisRegistry.getScale(axisId)
      if (!scale) continue
      const qk = this.axisRegistry.axisQuantityKinds[axisId]
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

  pick(x, y) {
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
      node.refreshIfNeeded(this)
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
        for (const col of layer._dataColumns ?? []) col.refresh(this)

        const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
        const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
        const props = {
          xDomain: layer.xAxis ? (this.axisRegistry.getScale(layer.xAxis)?.domain() ?? [0, 1]) : [0, 1],
          yDomain: layer.yAxis ? (this.axisRegistry.getScale(layer.yAxis)?.domain() ?? [0, 1]) : [0, 1],
          xScaleType: xIsLog ? 1.0 : 0.0,
          yScaleType: yIsLog ? 1.0 : 0.0,
          viewport,
          count: layer.vertexCount ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length ?? 0,
          u_pickingMode: 1.0,
          u_pickLayerIndex: i,
        }
        if (layer.instanceCount !== null) props.instances = layer.instanceCount
        for (const qk of Object.values(layer.colorAxes)) {
          props[`colorscale_${qk}`] = this.colorAxisRegistry.getColorscaleIndex(qk)
          const range = this.colorAxisRegistry.getRange(qk)
          props[`color_range_${qk}`] = range ?? [0, 1]
          props[`color_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
          props[`alpha_blend_${qk}`] = this.colorAxisRegistry.getAlphaBlend(qk)
        }
        for (const qk of Object.values(layer.filterAxes)) {
          props[`filter_range_${qk}`] = this.filterAxisRegistry.getRangeUniform(qk)
          props[`filter_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
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
