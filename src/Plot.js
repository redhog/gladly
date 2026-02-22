import reglInit from "regl"
import * as d3 from "d3-selection"
import { AXES, AxisRegistry } from "./AxisRegistry.js"
import { Axis } from "./Axis.js"
import { ColorAxisRegistry } from "./ColorAxisRegistry.js"
import { FilterAxisRegistry } from "./FilterAxisRegistry.js"
import { ZoomController } from "./ZoomController.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityKind, getScaleTypeFloat } from "./AxisQuantityKindRegistry.js"
import { getRegisteredColorscales } from "./ColorscaleRegistry.js"

function buildPlotSchema(data) {
  const layerTypes = getRegisteredLayerTypes()

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      layers: {
        type: "array",
        items: {
          type: "object",
          oneOf: layerTypes.map(typeName => {
            const layerType = getLayerType(typeName)
            return {
              title: typeName,
              properties: {
                [typeName]: layerType.schema(data)
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
              enum: [...getRegisteredColorscales().keys()]
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
      }
    }
  }
}

export class Plot {
  static _FloatClass = null
  static _FilterbarFloatClass = null
  constructor(container, { margin } = {}) {
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
    this.currentData = null
    this.regl = null
    this.layers = []
    this.axisRegistry = null
    this.colorAxisRegistry = null
    this.filterAxisRegistry = null
    this._renderCallbacks = new Set()
    this._dirty = false
    this._rafId = null

    // Stable Axis instances keyed by axis name — persist across update() calls
    this._axisCache = new Map()
    this._axesProxy = null

    // Auto-managed Float colorbars keyed by color axis name
    this._floats = new Map()
    // Auto-managed FilterbarFloat widgets keyed by filter axis name
    this._filterbarFloats = new Map()

    this._setupResizeObserver()
  }

  update({ config, data } = {}) {
    const previousConfig = this.currentConfig
    const previousData = this.currentData

    try {
      if (config !== undefined) {
        this.currentConfig = config
      }
      if (data !== undefined) {
        this.currentData = data
      }

      if (!this.currentConfig || !this.currentData) {
        return
      }

      const width = this.container.clientWidth
      const height = this.container.clientHeight
      const plotWidth = width - this.margin.left - this.margin.right
      const plotHeight = height - this.margin.top - this.margin.bottom

      // Container is hidden, not yet laid out, or too small to fit the margins.
      // Store config/data and return; ResizeObserver will call forceUpdate() once
      // the container gets real dimensions.
      if (width === 0 || height === 0 || plotWidth <= 0 || plotHeight <= 0) {
        return
      }

      this.canvas.width = width
      this.canvas.height = height
      this.svg.attr('width', width).attr('height', height)

      this.width = width
      this.height = height
      this.plotWidth = plotWidth
      this.plotHeight = plotHeight

      if (this.regl) {
        this.regl.destroy()
      }

      this.svg.selectAll('*').remove()

      this._initialize()
      this._syncFloats()
    } catch (error) {
      this.currentConfig = previousConfig
      this.currentData = previousData
      throw error
    }
  }

  forceUpdate() {
    this.update({})
  }

  /**
   * Returns a stable Axis instance for the given axis name.
   * Works for spatial axes (e.g. "xaxis_bottom") and quantity-kind axes (color/filter).
   * The same instance is returned across plot.update() calls, so links survive updates.
   *
   * Usage: plot.axes.xaxis_bottom, plot.axes["velocity_ms"], etc.
   */
  get axes() {
    if (!this._axesProxy) {
      this._axesProxy = new Proxy(this._axisCache, {
        get: (cache, name) => {
          if (typeof name !== 'string') return undefined
          if (!cache.has(name)) cache.set(name, new Axis(this, name))
          return cache.get(name)
        }
      })
    }
    return this._axesProxy
  }

  _getAxis(name) {
    if (!this._axisCache.has(name)) this._axisCache.set(name, new Axis(this, name))
    return this._axisCache.get(name)
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

    return { ...this.currentConfig, axes }
  }

  _initialize() {
    const { layers = [], axes = {} } = this.currentConfig

    this.regl = reglInit({ canvas: this.canvas, extensions: ['ANGLE_instanced_arrays'] })

    this.layers = []

    AXES.forEach(a => this.svg.append("g").attr("class", a))

    this.axisRegistry = new AxisRegistry(this.plotWidth, this.plotHeight)
    this.colorAxisRegistry = new ColorAxisRegistry()
    this.filterAxisRegistry = new FilterAxisRegistry()

    this._processLayers(layers, this.currentData)
    this._setDomains(axes)

    new ZoomController(this)
    this.render()
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // Defer to next animation frame so the ResizeObserver callback exits
        // before any DOM/layout changes happen, avoiding the "loop completed
        // with undelivered notifications" browser error.
        requestAnimationFrame(() => this.forceUpdate())
      })
      this.resizeObserver.observe(this.container)
    } else {
      this._resizeHandler = () => this.forceUpdate()
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
    const axes = this.currentConfig?.axes ?? {}

    // --- Color axis floats ---
    const desiredColor = new Map()
    for (const [axisName, axisConfig] of Object.entries(axes)) {
      if (AXES.includes(axisName)) continue  // skip spatial axes
      const cb = axisConfig.colorbar
      if (cb === "vertical" || cb === "horizontal") {
        desiredColor.set(axisName, cb)
      }
    }

    for (const [axisName, float] of this._floats) {
      const wantedOrientation = desiredColor.get(axisName)
      if (wantedOrientation === undefined || wantedOrientation !== float._colorbar._orientation) {
        float.destroy()
        this._floats.delete(axisName)
      }
    }

    for (const [axisName, orientation] of desiredColor) {
      if (!this._floats.has(axisName)) {
        this._floats.set(axisName, new Plot._FloatClass(this, axisName, { orientation }))
      }
    }

    // --- Filter axis floats ---
    const desiredFilter = new Map()
    for (const [axisName, axisConfig] of Object.entries(axes)) {
      if (AXES.includes(axisName)) continue
      if (!this.filterAxisRegistry?.hasAxis(axisName)) continue
      const fb = axisConfig.filterbar
      if (fb === "vertical" || fb === "horizontal") {
        desiredFilter.set(axisName, fb)
      }
    }

    for (const [axisName, float] of this._filterbarFloats) {
      const wantedOrientation = desiredFilter.get(axisName)
      if (wantedOrientation === undefined || wantedOrientation !== float._filterbar._orientation) {
        float.destroy()
        this._filterbarFloats.delete(axisName)
      }
    }

    for (const [axisName, orientation] of desiredFilter) {
      if (!this._filterbarFloats.has(axisName)) {
        this._filterbarFloats.set(axisName, new Plot._FilterbarFloatClass(this, axisName, { orientation }))
      }
    }
  }

  destroy() {
    for (const float of this._floats.values()) {
      float.destroy()
    }
    this._floats.clear()

    for (const float of this._filterbarFloats.values()) {
      float.destroy()
    }
    this._filterbarFloats.clear()

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

    if (this.regl) {
      this.regl.destroy()
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

      // Resolve axis config once per layer spec for registration (independent of draw call count).
      const ac = layerType.resolveAxisConfig(parameters, data)
      const axesConfig = this.currentConfig?.axes ?? {}

      // Register spatial axes (null means no axis for that direction).
      // Pass any scale override from config (e.g. "log") so the D3 scale is created correctly.
      if (ac.xAxis) this.axisRegistry.ensureAxis(ac.xAxis, ac.xAxisQuantityKind, axesConfig[ac.xAxis]?.scale ?? axesConfig[ac.xAxisQuantityKind]?.scale)
      if (ac.yAxis) this.axisRegistry.ensureAxis(ac.yAxis, ac.yAxisQuantityKind, axesConfig[ac.yAxis]?.scale ?? axesConfig[ac.yAxisQuantityKind]?.scale)

      // Register color axes (colorscale comes from config or quantity kind registry, not from here)
      for (const quantityKind of ac.colorAxisQuantityKinds) {
        this.colorAxisRegistry.ensureColorAxis(quantityKind)
      }

      // Register filter axes
      for (const quantityKind of ac.filterAxisQuantityKinds) {
        this.filterAxisRegistry.ensureFilterAxis(quantityKind)
      }

      // Create one draw command per GPU config returned by the layer type.
      for (const layer of layerType.createLayer(parameters, data)) {
        layer.configLayerIndex = configLayerIndex
        layer.draw = layer.type.createDrawCommand(this.regl, layer, this)
        this.layers.push(layer)
      }
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

  static schema(data) {
    return buildPlotSchema(data)
  }

  scheduleRender() {
    this._dirty = true
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null
        if (this._dirty) {
          this._dirty = false
          this.render()
        }
      })
    }
  }

  render() {
    this._dirty = false
    this.regl.clear({ color: [1,1,1,1], depth:1 })
    const viewport = {
      x: this.margin.left,
      y: this.margin.bottom,
      width: this.plotWidth,
      height: this.plotHeight
    }
    const axesConfig = this.currentConfig?.axes

    for (const layer of this.layers) {
      const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
      const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
      const props = {
        xDomain: layer.xAxis ? this.axisRegistry.getScale(layer.xAxis).domain() : [0, 1],
        yDomain: layer.yAxis ? this.axisRegistry.getScale(layer.yAxis).domain() : [0, 1],
        xScaleType: xIsLog ? 1.0 : 0.0,
        yScaleType: yIsLog ? 1.0 : 0.0,
        viewport: viewport,
        count: layer.vertexCount ?? layer.attributes.x?.length ?? 0,
        u_pickingMode: 0.0,
        u_pickLayerIndex: 0.0,
      }

      if (layer.instanceCount !== null) {
        props.instances = layer.instanceCount
      }

      for (const qk of layer.colorAxes) {
        props[`colorscale_${qk}`] = this.colorAxisRegistry.getColorscaleIndex(qk)
        const range = this.colorAxisRegistry.getRange(qk)
        props[`color_range_${qk}`] = range ?? [0, 1]
        props[`color_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
      }

      for (const qk of layer.filterAxes) {
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

    const fbo = this.regl.framebuffer({
      width: this.width, height: this.height,
      colorFormat: 'rgba', colorType: 'uint8', depth: false,
    })

    const glX = Math.round(x)
    const glY = this.height - Math.round(y) - 1
    const axesConfig = this.currentConfig?.axes

    let result = null
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
        const props = {
          xDomain: layer.xAxis ? this.axisRegistry.getScale(layer.xAxis).domain() : [0, 1],
          yDomain: layer.yAxis ? this.axisRegistry.getScale(layer.yAxis).domain() : [0, 1],
          xScaleType: xIsLog ? 1.0 : 0.0,
          yScaleType: yIsLog ? 1.0 : 0.0,
          viewport,
          count: layer.vertexCount ?? layer.attributes.x?.length ?? 0,
          u_pickingMode: 1.0,
          u_pickLayerIndex: i,
        }
        if (layer.instanceCount !== null) props.instances = layer.instanceCount
        for (const qk of layer.colorAxes) {
          props[`colorscale_${qk}`] = this.colorAxisRegistry.getColorscaleIndex(qk)
          const range = this.colorAxisRegistry.getRange(qk)
          props[`color_range_${qk}`] = range ?? [0, 1]
          props[`color_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
        }
        for (const qk of layer.filterAxes) {
          props[`filter_range_${qk}`] = this.filterAxisRegistry.getRangeUniform(qk)
          props[`filter_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
        }
        layer.draw(props)
      }
      const pixels = this.regl.read({ x: glX, y: glY, width: 1, height: 1 })
      if (pixels[0] === 0) {
        result = null
      } else {
        const layerIndex = pixels[0] - 1
        const dataIndex = (pixels[1] << 16) | (pixels[2] << 8) | pixels[3]
        const layer = this.layers[layerIndex]
        result = { layerIndex, configLayerIndex: layer.configLayerIndex, dataIndex, layer }
      }
    })

    fbo.destroy()
    return result
  }
}
