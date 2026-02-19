import reglInit from "regl"
import * as d3 from "d3-selection"
import { scaleLinear } from "d3-scale"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom, zoomIdentity } from "d3-zoom"
import { AXES, AxisRegistry } from "./AxisRegistry.js"
import { ColorAxisRegistry } from "./ColorAxisRegistry.js"
import { FilterAxisRegistry } from "./FilterAxisRegistry.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"
import { getRegisteredColorscales } from "./ColorscaleRegistry.js"

function formatTick(v) {
  if (v === 0) return "0"
  const abs = Math.abs(v)
  if (abs >= 10000 || abs < 0.01) {
    return v.toExponential(2)
  }
  const s = v.toPrecision(4)
  if (s.includes('.') && !s.includes('e')) {
    return s.replace(/\.?0+$/, '')
  }
  return s
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

    // Axis links (persists across updates); any axis ID (spatial or color) is allowed
    this.axisLinks = new Map()
    AXES.forEach(axis => this.axisLinks.set(axis, new Set()))

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

      // Container is hidden or not yet laid out (e.g. inside display:none tab).
      // Store config/data and return; ResizeObserver will call forceUpdate() once
      // the container gets real dimensions.
      if (width === 0 || height === 0) {
        return
      }

      this.canvas.width = width
      this.canvas.height = height
      this.svg.attr('width', width).attr('height', height)

      this.width = width
      this.height = height
      this.plotWidth = width - this.margin.left - this.margin.right
      this.plotHeight = height - this.margin.top - this.margin.bottom

      const { layers: pendingLayers = [] } = this.currentConfig
      this._preValidateAxisLinks(pendingLayers, this.currentData)

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

    this.initZoom()
    this.render()
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.forceUpdate()
      })
      this.resizeObserver.observe(this.container)
    } else {
      this._resizeHandler = () => this.forceUpdate()
      window.addEventListener('resize', this._resizeHandler)
    }
  }

  _addAxisLink(axisName, link) {
    try {
      if (!this.axisLinks) {
        this.axisLinks = new Map()
      }
      if (!this.axisLinks.has(axisName)) {
        this.axisLinks.set(axisName, new Set())
      }
      this.axisLinks.get(axisName).add(link)
    } catch (error) {
      console.error('Error adding axis link:', error)
    }
  }

  _removeAxisLink(axisName, link) {
    try {
      if (this.axisLinks && this.axisLinks.has(axisName)) {
        this.axisLinks.get(axisName).delete(link)
      }
    } catch (error) {
      console.error('Error removing axis link:', error)
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

  _preValidateAxisLinks(layersConfig, data) {
    const pendingKinds = {}

    for (const layerSpec of layersConfig) {
      const entries = Object.entries(layerSpec)
      if (entries.length !== 1) continue

      const [layerTypeName, parameters] = entries[0]
      const layerType = getLayerType(layerTypeName)
      const ac = layerType.resolveAxisConfig(parameters, data)

      for (const [axisName, kind] of [
        [ac.xAxis, ac.xAxisQuantityKind],
        [ac.yAxis, ac.yAxisQuantityKind]
      ]) {
        if (!axisName || !kind) continue

        if (pendingKinds[axisName] && pendingKinds[axisName] !== kind) {
          throw new Error(`Axis kind conflict on ${axisName}: ${pendingKinds[axisName]} vs ${kind}`)
        }
        pendingKinds[axisName] = kind

        const links = this.axisLinks.get(axisName)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, axisName)
          if (!linked) continue

          const linkedKind = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedKind) continue

          if (kind !== linkedKind) {
            throw new Error(
              `Linked axes have incompatible quantity kinds: ` +
              `${axisName} (${kind}) cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedKind})`
            )
          }
        }
      }

      // Validate color axis links
      for (const quantityKind of ac.colorAxisQuantityKinds) {
        const links = this.axisLinks.get(quantityKind)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, quantityKind)
          if (!linked) continue

          const linkedKind = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedKind) continue

          if (quantityKind !== linkedKind) {
            throw new Error(
              `Linked axes have incompatible quantity kinds: ` +
              `color axis '${quantityKind}' cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedKind})`
            )
          }
        }
      }

      // Validate filter axis links
      for (const quantityKind of ac.filterAxisQuantityKinds) {
        const links = this.axisLinks.get(quantityKind)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, quantityKind)
          if (!linked) continue

          const linkedKind = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedKind) continue

          if (quantityKind !== linkedKind) {
            throw new Error(
              `Linked axes have incompatible quantity kinds: ` +
              `filter axis '${quantityKind}' cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedKind})`
            )
          }
        }
      }
    }
  }

  _validateAxisLinks(axisId) {
    const links = this.axisLinks.get(axisId)
    if (!links || links.size === 0) return

    const thisKind = this.getAxisQuantityKind(axisId)
    if (!thisKind) return

    for (const link of links) {
      const linked = link.getLinkedAxis(this, axisId)
      if (!linked) continue

      const linkedKind = linked.plot.getAxisQuantityKind(linked.axis)
      if (!linkedKind) continue

      if (thisKind !== linkedKind) {
        throw new Error(
          `Linked axes have incompatible quantity kinds: ` +
          `${axisId} (${thisKind}) cannot link to ` +
          `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedKind})`
        )
      }
    }
  }

  _propagateDomainToLinks(axisId, newDomain) {
    try {
      const links = this.axisLinks.get(axisId)
      if (!links || links.size === 0) return

      for (const link of links) {
        const linked = link.getLinkedAxis(this, axisId)
        if (!linked) continue

        linked.plot.setAxisDomain(linked.axis, newDomain)
        linked.plot.scheduleRender()
      }
    } catch (error) {
      console.error('Error propagating domain to linked axes:', error)
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

    const allLinks = new Set()
    for (const links of this.axisLinks.values()) {
      for (const link of links) {
        allLinks.add(link)
      }
    }
    for (const link of allLinks) {
      link.unlink()
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
    for (const layerSpec of layersConfig) {
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

      if (ac.xAxis) this._validateAxisLinks(ac.xAxis)
      if (ac.yAxis) this._validateAxisLinks(ac.yAxis)

      // Register color axes (colorscale comes from config or quantity kind registry, not from here)
      for (const quantityKind of ac.colorAxisQuantityKinds) {
        this.colorAxisRegistry.ensureColorAxis(quantityKind)
        this._validateAxisLinks(quantityKind)
      }

      // Register filter axes
      for (const quantityKind of ac.filterAxisQuantityKinds) {
        this.filterAxisRegistry.ensureFilterAxis(quantityKind)
        this._validateAxisLinks(quantityKind)
      }

      // Create one draw command per GPU config returned by the layer type.
      for (const layer of layerType.createLayer(parameters, data)) {
        layer.draw = layer.type.createDrawCommand(this.regl, layer)
        this.layers.push(layer)
      }
    }
  }

  _setDomains(axesOverrides) {
    // Auto-calculate spatial axis domains
    const autoDomains = {}

    for (const axis of AXES) {
      const layersUsingAxis = this.layers.filter(l =>
        l.xAxis === axis || l.yAxis === axis
      )

      if (layersUsingAxis.length === 0) continue

      let min = Infinity
      let max = -Infinity

      for (const layer of layersUsingAxis) {
        const isXAxis = layer.xAxis === axis
        const qk = isXAxis ? layer.xAxisQuantityKind : layer.yAxisQuantityKind
        if (layer.domains[qk] !== undefined) {
          const [dMin, dMax] = layer.domains[qk]
          if (dMin < min) min = dMin
          if (dMax > max) max = dMax
        } else {
          const dataArray = isXAxis ? layer.attributes.x : layer.attributes.y
          if (!dataArray) continue
          for (let i = 0; i < dataArray.length; i++) {
            const val = dataArray[i]
            if (val < min) min = val
            if (val > max) max = val
          }
        }
      }

      if (min !== Infinity) autoDomains[axis] = [min, max]
    }

    for (const axis of AXES) {
      const scale = this.axisRegistry.getScale(axis)
      if (scale) {
        let domain
        if (axesOverrides[axis]) {
          const override = axesOverrides[axis]
          domain = [override.min, override.max]
        } else {
          domain = autoDomains[axis]
        }
        if (domain) {
          scale.domain(domain)
        }
      }
    }

    // Compute data extent for each filter axis and store it (used by Filterbar for display).
    // Data comes from the attribute named by the quantity kind. If absent, auto-range is skipped.
    // Also apply any range overrides from config; default is fully open bounds (no filtering).
    for (const quantityKind of this.filterAxisRegistry.getQuantityKinds()) {
      let extMin = Infinity, extMax = -Infinity
      for (const layer of this.layers) {
        for (const qk of layer.filterAxes) {
          if (qk !== quantityKind) continue
          if (layer.domains[qk] !== undefined) {
            const [dMin, dMax] = layer.domains[qk]
            if (dMin < extMin) extMin = dMin
            if (dMax > extMax) extMax = dMax
          } else {
            const data = layer.attributes[qk]
            if (!data) continue
            for (let i = 0; i < data.length; i++) {
              if (data[i] < extMin) extMin = data[i]
              if (data[i] > extMax) extMax = data[i]
            }
          }
        }
      }
      if (extMin !== Infinity) {
        this.filterAxisRegistry.setDataExtent(quantityKind, extMin, extMax)
      }

      if (axesOverrides[quantityKind]) {
        const override = axesOverrides[quantityKind]
        const min = override.min !== undefined ? override.min : null
        const max = override.max !== undefined ? override.max : null
        this.filterAxisRegistry.setRange(quantityKind, min, max)
      }
    }

    // Auto-calculate color axis domains.
    // Data comes from the attribute named by the quantity kind. If absent, auto-range is skipped
    // (e.g. ColorbarLayer, whose range is always synced externally from the target plot).
    for (const quantityKind of this.colorAxisRegistry.getQuantityKinds()) {
      let min = Infinity
      let max = -Infinity

      for (const layer of this.layers) {
        for (const qk of layer.colorAxes) {
          if (qk !== quantityKind) continue
          // Use layer-declared domain if provided, otherwise scan the attribute array.
          if (layer.domains[qk] !== undefined) {
            const [dMin, dMax] = layer.domains[qk]
            if (dMin < min) min = dMin
            if (dMax > max) max = dMax
          } else {
            const data = layer.attributes[qk]
            if (!data) continue
            for (let i = 0; i < data.length; i++) {
              if (data[i] < min) min = data[i]
              if (data[i] > max) max = data[i]
            }
          }
        }
      }

      if (min !== Infinity) {
        const override = axesOverrides[quantityKind]
        if (override?.colorscale) {
          this.colorAxisRegistry.ensureColorAxis(quantityKind, override.colorscale)
        }
        // Config min/max override the auto-calculated values; absent means keep auto value.
        this.colorAxisRegistry.setRange(quantityKind, override?.min ?? min, override?.max ?? max)
      }
    }

    // Validate that log-scale axes have strictly positive domains/ranges.
    for (const axis of AXES) {
      if (!this.axisRegistry.isLogScale(axis)) continue
      const [dMin, dMax] = this.axisRegistry.getScale(axis).domain()
      if ((isFinite(dMin) && dMin <= 0) || (isFinite(dMax) && dMax <= 0)) {
        throw new Error(
          `Axis '${axis}' uses log scale but has non-positive domain [${dMin}, ${dMax}]. ` +
          `All data values and min/max must be > 0 for log scale.`
        )
      }
    }

    for (const quantityKind of this.colorAxisRegistry.getQuantityKinds()) {
      if (this._getScaleTypeFloat(quantityKind) <= 0.5) continue
      const range = this.colorAxisRegistry.getRange(quantityKind)
      if (!range) continue
      if (range[0] <= 0 || range[1] <= 0) {
        throw new Error(
          `Color axis '${quantityKind}' uses log scale but has non-positive range [${range[0]}, ${range[1]}]. ` +
          `All data values and min/max must be > 0 for log scale.`
        )
      }
    }

    for (const quantityKind of this.filterAxisRegistry.getQuantityKinds()) {
      if (this._getScaleTypeFloat(quantityKind) <= 0.5) continue
      const extent = this.filterAxisRegistry.getDataExtent(quantityKind)
      if (extent && extent[0] <= 0) {
        throw new Error(
          `Filter axis '${quantityKind}' uses log scale but data minimum is ${extent[0]}. ` +
          `All data values must be > 0 for log scale.`
        )
      }
      const filterRange = this.filterAxisRegistry.getRange(quantityKind)
      if (filterRange) {
        if (filterRange.min !== null && filterRange.min <= 0) {
          throw new Error(
            `Filter axis '${quantityKind}' uses log scale but min is ${filterRange.min}. ` +
            `min must be > 0 for log scale.`
          )
        }
        if (filterRange.max !== null && filterRange.max <= 0) {
          throw new Error(
            `Filter axis '${quantityKind}' uses log scale but max is ${filterRange.max}. ` +
            `max must be > 0 for log scale.`
          )
        }
      }
    }
  }

  static schema(data) {
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
                scale: { type: "string", enum: ["linear", "log"] }
              }
            },
            xaxis_top: {
              type: "object",
              properties: {
                min: { type: "number" },
                max: { type: "number" },
                label: { type: "string" },
                scale: { type: "string", enum: ["linear", "log"] }
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

  _tickCount(axisName) {
    if (axisName.includes("y")) {
      return Math.max(2, Math.floor(this.plotHeight / 27))
    }
    return Math.max(2, Math.floor(this.plotWidth / 40))
  }

  _makeAxis(axisConstructor, scale, axisName) {
    const count = this._tickCount(axisName)
    const gen = axisConstructor(scale).tickFormat(formatTick)
    if (count <= 2) {
      gen.tickValues(scale.domain())
    } else {
      gen.ticks(count)
    }
    return gen
  }

  renderAxes() {
    if (this.axisRegistry.getScale("xaxis_bottom")) {
      const scale = this.axisRegistry.getScale("xaxis_bottom")
      const g = this.svg.select(".xaxis_bottom")
        .attr("transform", `translate(${this.margin.left},${this.margin.top + this.plotHeight})`)
        .call(this._makeAxis(axisBottom, scale, "xaxis_bottom"))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "xaxis_bottom", this.plotWidth / 2, this.margin.bottom)
    }
    if (this.axisRegistry.getScale("xaxis_top")) {
      const scale = this.axisRegistry.getScale("xaxis_top")
      const g = this.svg.select(".xaxis_top")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(this._makeAxis(axisTop, scale, "xaxis_top"))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "xaxis_top", this.plotWidth / 2, this.margin.top)
    }
    if (this.axisRegistry.getScale("yaxis_left")) {
      const scale = this.axisRegistry.getScale("yaxis_left")
      const g = this.svg.select(".yaxis_left")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(this._makeAxis(axisLeft, scale, "yaxis_left"))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_left", -this.plotHeight / 2, this.margin.left)
    }
    if (this.axisRegistry.getScale("yaxis_right")) {
      const scale = this.axisRegistry.getScale("yaxis_right")
      const g = this.svg.select(".yaxis_right")
        .attr("transform", `translate(${this.margin.left + this.plotWidth},${this.margin.top})`)
        .call(this._makeAxis(axisRight, scale, "yaxis_right"))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_right", -this.plotHeight / 2, this.margin.right)
    }
  }

  updateAxisLabel(axisGroup, axisName, centerPos, availableMargin) {
    const axisQuantityKind = this.axisRegistry.axisQuantityKinds[axisName]
    if (!axisQuantityKind) return

    const unitLabel = this.currentConfig?.axes?.[axisQuantityKind]?.label
      ?? getAxisQuantityKind(axisQuantityKind).label
    const isVertical = axisName.includes("y")
    const padding = 5

    axisGroup.select(".axis-label").remove()

    const text = axisGroup.append("text")
      .attr("class", "axis-label")
      .attr("fill", "#000")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "bold")

    const lines = unitLabel.split('\n')
    if (lines.length > 1) {
      lines.forEach((line, i) => {
        text.append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? "0em" : "1.2em")
          .text(line)
      })
    } else {
      text.text(unitLabel)
    }

    if (isVertical) {
      text.attr("transform", "rotate(-90)")
    }

    text.attr("x", centerPos).attr("y", 0)

    const bbox = text.node().getBBox()
    const tickSpace = 25

    let yOffset

    if (axisName === "xaxis_bottom") {
      const centerY = tickSpace + (availableMargin - tickSpace) / 2
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "xaxis_top") {
      const centerY = -(tickSpace + (availableMargin - tickSpace) / 2)
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "yaxis_left") {
      const centerY = -(tickSpace + (availableMargin - tickSpace) / 2)
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "yaxis_right") {
      const centerY = tickSpace + (availableMargin - tickSpace) / 2
      yOffset = centerY - (bbox.y + bbox.height / 2)
    }

    text.attr("y", yOffset)
  }

  _getScaleTypeFloat(quantityKind) {
    const configScale = this.currentConfig?.axes?.[quantityKind]?.scale
    const defScale = getAxisQuantityKind(quantityKind).scale
    return (configScale ?? defScale) === "log" ? 1.0 : 0.0
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
    for (const layer of this.layers) {
      const xIsLog = layer.xAxis ? this.axisRegistry.isLogScale(layer.xAxis) : false
      const yIsLog = layer.yAxis ? this.axisRegistry.isLogScale(layer.yAxis) : false
      const props = {
        xDomain: layer.xAxis ? this.axisRegistry.getScale(layer.xAxis).domain() : [0, 1],
        yDomain: layer.yAxis ? this.axisRegistry.getScale(layer.yAxis).domain() : [0, 1],
        xScaleType: xIsLog ? 1.0 : 0.0,
        yScaleType: yIsLog ? 1.0 : 0.0,
        viewport: viewport,
        count: layer.vertexCount ?? layer.attributes.x?.length ?? 0
      }

      if (layer.instanceCount !== null) {
        props.instances = layer.instanceCount
      }

      // Add color axis uniforms, keyed by quantity kind
      for (const qk of layer.colorAxes) {
        props[`colorscale_${qk}`] = this.colorAxisRegistry.getColorscaleIndex(qk)
        const range = this.colorAxisRegistry.getRange(qk)
        props[`color_range_${qk}`] = range ?? [0, 1]
        props[`color_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
      }

      // Add filter axis uniforms (vec4: [min, max, hasMin, hasMax]), keyed by quantity kind
      for (const qk of layer.filterAxes) {
        props[`filter_range_${qk}`] = this.filterAxisRegistry.getRangeUniform(qk)
        props[`filter_scale_type_${qk}`] = this._getScaleTypeFloat(qk)
      }

      layer.draw(props)
    }
    this.renderAxes()
    for (const cb of this._renderCallbacks) cb()
  }

  initZoom() {
    const fullOverlay = this.svg.append("rect")
      .attr("class", "zoom-overlay")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "move")

    let currentRegion = null
    let gestureStartDomains = {}
    let gestureStartMousePos = {}
    let gestureStartDataPos = {}
    let gestureStartTransform = null

    const zoomBehavior = zoom()
      .on("start", (event) => {
        if (!event.sourceEvent) return

        gestureStartTransform = { k: event.transform.k, x: event.transform.x, y: event.transform.y }
        const [mouseX, mouseY] = d3.pointer(event.sourceEvent, this.svg.node())

        const inPlotX = mouseX >= this.margin.left && mouseX < this.margin.left + this.plotWidth
        const inPlotY = mouseY >= this.margin.top && mouseY < this.margin.top + this.plotHeight

        if (inPlotX && mouseY < this.margin.top) {
          currentRegion = "xaxis_top"
        } else if (inPlotX && mouseY >= this.margin.top + this.plotHeight) {
          currentRegion = "xaxis_bottom"
        } else if (inPlotY && mouseX < this.margin.left) {
          currentRegion = "yaxis_left"
        } else if (inPlotY && mouseX >= this.margin.left + this.plotWidth) {
          currentRegion = "yaxis_right"
        } else if (inPlotX && inPlotY) {
          currentRegion = "plot_area"
        } else {
          currentRegion = null
        }

        gestureStartDomains = {}
        gestureStartMousePos = {}
        gestureStartDataPos = {}
        if (currentRegion && this.axisRegistry) {
          const axesToZoom = currentRegion === "plot_area" ? AXES : [currentRegion]
          axesToZoom.forEach(axis => {
            const scale = this.axisRegistry.getScale(axis)
            if (scale) {
              const currentDomain = scale.domain()
              gestureStartDomains[axis] = currentDomain.slice()

              const isY = axis.includes("y")
              const mousePixel = isY ? (mouseY - this.margin.top) : (mouseX - this.margin.left)
              gestureStartMousePos[axis] = mousePixel

              const pixelSize = isY ? this.plotHeight : this.plotWidth
              const [d0, d1] = currentDomain
              const isLog = this.axisRegistry.isLogScale(axis)
              const t0 = isLog ? Math.log(d0) : d0
              const t1 = isLog ? Math.log(d1) : d1
              const tDomainWidth = t1 - t0
              const fraction = mousePixel / pixelSize

              if (isY) {
                gestureStartDataPos[axis] = t1 - fraction * tDomainWidth
              } else {
                gestureStartDataPos[axis] = t0 + fraction * tDomainWidth
              }
            }
          })
        }
      })
      .on("zoom", (event) => {
        if (!this.axisRegistry || !currentRegion || !gestureStartTransform) return

        const deltaK = event.transform.k / gestureStartTransform.k
        const deltaX = event.transform.x - gestureStartTransform.x
        const deltaY = event.transform.y - gestureStartTransform.y

        const isWheel = event.sourceEvent && event.sourceEvent.type === 'wheel'

        const axesToZoom = currentRegion === "plot_area" ? AXES : [currentRegion]

        axesToZoom.forEach(axis => {
          const scale = this.axisRegistry.getScale(axis)
          if (scale && gestureStartDomains[axis] && gestureStartDataPos[axis] !== undefined) {
            const isY = axis.includes("y")
            const [d0, d1] = gestureStartDomains[axis]
            const isLog = this.axisRegistry.isLogScale(axis)
            const t0 = isLog ? Math.log(d0) : d0
            const t1 = isLog ? Math.log(d1) : d1
            const tDomainWidth = t1 - t0

            const pixelSize = isY ? this.plotHeight : this.plotWidth
            const pixelDelta = isY ? deltaY : deltaX
            const zoomScale = deltaK
            const mousePixelPos = gestureStartMousePos[axis]
            const targetDataPos = gestureStartDataPos[axis]  // stored in transform space

            const newTDomainWidth = tDomainWidth / zoomScale

            const panTDomainDelta = isWheel ? 0 : (isY
              ? pixelDelta * tDomainWidth / pixelSize / zoomScale
              : -pixelDelta * tDomainWidth / pixelSize / zoomScale)

            const fraction = mousePixelPos / pixelSize
            let tCenter

            if (isY) {
              tCenter = (targetDataPos + panTDomainDelta) + (fraction - 0.5) * newTDomainWidth
            } else {
              tCenter = (targetDataPos + panTDomainDelta) + (0.5 - fraction) * newTDomainWidth
            }

            const newTDomain = [tCenter - newTDomainWidth / 2, tCenter + newTDomainWidth / 2]
            const newDomain = isLog
              ? [Math.exp(newTDomain[0]), Math.exp(newTDomain[1])]
              : newTDomain
            scale.domain(newDomain)

            if (event.sourceEvent) {
              this._propagateDomainToLinks(axis, newDomain)
            }
          }
        })

        this.scheduleRender()
      })
      .on("end", () => {
        currentRegion = null
        gestureStartDomains = {}
        gestureStartMousePos = {}
        gestureStartDataPos = {}
        gestureStartTransform = null
      })

    fullOverlay.call(zoomBehavior)
  }
}
