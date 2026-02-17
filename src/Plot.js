import reglInit from "regl"
import * as d3 from "d3-selection"
import { scaleLinear } from "d3-scale"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom, zoomIdentity } from "d3-zoom"
import { AXES, AxisRegistry } from "./AxisRegistry.js"
import { ColorAxisRegistry } from "./ColorAxisRegistry.js"
import { FilterAxisRegistry } from "./FilterAxisRegistry.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
import { getAxisQuantityUnit } from "./AxisQuantityUnitRegistry.js"
import { getRegisteredColorscales } from "./ColorscaleRegistry.js"

export class Plot {
  static _FloatClass = null
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
          axes[axisId] = { ...(axes[axisId] ?? {}), min, max }
        }
      }
    }

    if (this.colorAxisRegistry) {
      for (const quantityKind of this.colorAxisRegistry.getQuantityKinds()) {
        const range = this.colorAxisRegistry.getRange(quantityKind)
        const colorscale = this.colorAxisRegistry.getColorscale(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
          colorbar: "none",
          ...existing,
          ...(range ? { min: range[0], max: range[1] } : {}),
          ...(!existing.colorscale && colorscale ? { colorscale } : {})
        }
      }
    }

    if (this.filterAxisRegistry) {
      for (const quantityKind of this.filterAxisRegistry.getQuantityKinds()) {
        const range = this.filterAxisRegistry.getRange(quantityKind)
        const existing = axes[quantityKind] ?? {}
        axes[quantityKind] = {
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

    this.regl = reglInit({ canvas: this.canvas })

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
      return this.axisRegistry ? this.axisRegistry.axisQuantityUnits[axisId] : null
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
    } else {
      this.filterAxisRegistry?.setRange(axisId, domain[0], domain[1])
    }
  }

  _preValidateAxisLinks(layersConfig, data) {
    const pendingUnits = {}

    for (const layerSpec of layersConfig) {
      const entries = Object.entries(layerSpec)
      if (entries.length !== 1) continue

      const [layerTypeName, parameters] = entries[0]
      const layerType = getLayerType(layerTypeName)
      const layer = layerType.createLayer(parameters, data)

      for (const [axisName, unit] of [
        [layer.xAxis, layer.xAxisQuantityUnit],
        [layer.yAxis, layer.yAxisQuantityUnit]
      ]) {
        if (!axisName || !unit) continue

        if (pendingUnits[axisName] && pendingUnits[axisName] !== unit) {
          throw new Error(`Axis unit conflict on ${axisName}: ${pendingUnits[axisName]} vs ${unit}`)
        }
        pendingUnits[axisName] = unit

        const links = this.axisLinks.get(axisName)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, axisName)
          if (!linked) continue

          const linkedUnit = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedUnit) continue

          if (unit !== linkedUnit) {
            throw new Error(
              `Linked axes have incompatible quantity units: ` +
              `${axisName} (${unit}) cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedUnit})`
            )
          }
        }
      }

      // Validate color axis links
      for (const [slot, { quantityKind }] of Object.entries(layer.colorAxes)) {
        const links = this.axisLinks.get(quantityKind)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, quantityKind)
          if (!linked) continue

          const linkedUnit = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedUnit) continue

          if (quantityKind !== linkedUnit) {
            throw new Error(
              `Linked axes have incompatible quantity units: ` +
              `color axis '${quantityKind}' cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedUnit})`
            )
          }
        }
      }

      // Validate filter axis links
      for (const [slot, { quantityKind }] of Object.entries(layer.filterAxes)) {
        const links = this.axisLinks.get(quantityKind)
        if (!links || links.size === 0) continue

        for (const link of links) {
          const linked = link.getLinkedAxis(this, quantityKind)
          if (!linked) continue

          const linkedUnit = linked.plot.getAxisQuantityKind(linked.axis)
          if (!linkedUnit) continue

          if (quantityKind !== linkedUnit) {
            throw new Error(
              `Linked axes have incompatible quantity units: ` +
              `filter axis '${quantityKind}' cannot link to ` +
              `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedUnit})`
            )
          }
        }
      }
    }
  }

  _validateAxisLinks(axisId) {
    const links = this.axisLinks.get(axisId)
    if (!links || links.size === 0) return

    const thisUnit = this.getAxisQuantityKind(axisId)
    if (!thisUnit) return

    for (const link of links) {
      const linked = link.getLinkedAxis(this, axisId)
      if (!linked) continue

      const linkedUnit = linked.plot.getAxisQuantityKind(linked.axis)
      if (!linkedUnit) continue

      if (thisUnit !== linkedUnit) {
        throw new Error(
          `Linked axes have incompatible quantity units: ` +
          `${axisId} (${thisUnit}) cannot link to ` +
          `${linked.plot.container.id || 'plot'}.${linked.axis} (${linkedUnit})`
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

    // Determine desired state: map of axisName → orientation for color axes with colorbar set
    const desired = new Map()
    for (const [axisName, axisConfig] of Object.entries(axes)) {
      if (AXES.includes(axisName)) continue  // skip spatial axes
      const cb = axisConfig.colorbar
      if (cb === "vertical" || cb === "horizontal") {
        desired.set(axisName, cb)
      }
    }

    // Destroy floats that are no longer wanted or have changed orientation
    for (const [axisName, float] of this._floats) {
      const wantedOrientation = desired.get(axisName)
      if (wantedOrientation === undefined || wantedOrientation !== float._colorbar._orientation) {
        float.destroy()
        this._floats.delete(axisName)
      }
    }

    // Create floats that are newly wanted
    for (const [axisName, orientation] of desired) {
      if (!this._floats.has(axisName)) {
        this._floats.set(axisName, new Plot._FloatClass(this, axisName, { orientation }))
      }
    }
  }

  destroy() {
    for (const float of this._floats.values()) {
      float.destroy()
    }
    this._floats.clear()

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

      const layer = layerType.createLayer(parameters, data)

      // Register spatial axes (null means no axis for that direction)
      if (layer.xAxis) this.axisRegistry.ensureAxis(layer.xAxis, layer.xAxisQuantityUnit)
      if (layer.yAxis) this.axisRegistry.ensureAxis(layer.yAxis, layer.yAxisQuantityUnit)

      if (layer.xAxis) this._validateAxisLinks(layer.xAxis)
      if (layer.yAxis) this._validateAxisLinks(layer.yAxis)

      // Register color axes (pass optional layer-type default colorscale)
      for (const [slot, { quantityKind, colorscale }] of Object.entries(layer.colorAxes)) {
        this.colorAxisRegistry.ensureColorAxis(quantityKind, colorscale ?? null)
        this._validateAxisLinks(quantityKind)
      }

      // Register filter axes
      for (const [slot, { quantityKind }] of Object.entries(layer.filterAxes)) {
        this.filterAxisRegistry.ensureFilterAxis(quantityKind)
        this._validateAxisLinks(quantityKind)
      }

      layer.draw = layer.type.createDrawCommand(this.regl, layer)

      this.layers.push(layer)
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
        const dataArray = isXAxis ? layer.attributes.x : layer.attributes.y
        if (!dataArray) continue

        for (let i = 0; i < dataArray.length; i++) {
          const val = dataArray[i]
          if (val < min) min = val
          if (val > max) max = val
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

    // Apply filter axis ranges from config (default: open bounds — no filtering)
    for (const quantityKind of this.filterAxisRegistry.getQuantityKinds()) {
      if (axesOverrides[quantityKind]) {
        const override = axesOverrides[quantityKind]
        const min = override.min !== undefined ? override.min : null
        const max = override.max !== undefined ? override.max : null
        this.filterAxisRegistry.setRange(quantityKind, min, max)
      }
    }

    // Auto-calculate color axis domains
    for (const quantityKind of this.colorAxisRegistry.getQuantityKinds()) {
      let min = Infinity
      let max = -Infinity

      for (const layer of this.layers) {
        for (const [slot, { quantityKind: qk, data }] of Object.entries(layer.colorAxes)) {
          if (qk === quantityKind) {
            for (let i = 0; i < data.length; i++) {
              if (data[i] < min) min = data[i]
              if (data[i] > max) max = data[i]
            }
          }
        }
      }

      if (min !== Infinity) {
        if (axesOverrides[quantityKind]) {
          const override = axesOverrides[quantityKind]
          if (override.colorscale) {
            this.colorAxisRegistry.ensureColorAxis(quantityKind, override.colorscale)
          }
          this.colorAxisRegistry.setRange(quantityKind, override.min, override.max)
        } else {
          this.colorAxisRegistry.setRange(quantityKind, min, max)
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
                max: { type: "number" }
              },
              required: ["min", "max"],
              additionalProperties: false
            },
            xaxis_top: {
              type: "object",
              properties: {
                min: { type: "number" },
                max: { type: "number" }
              },
              required: ["min", "max"],
              additionalProperties: false
            },
            yaxis_left: {
              type: "object",
              properties: {
                min: { type: "number" },
                max: { type: "number" }
              },
              required: ["min", "max"],
              additionalProperties: false
            },
            yaxis_right: {
              type: "object",
              properties: {
                min: { type: "number" },
                max: { type: "number" }
              },
              required: ["min", "max"],
              additionalProperties: false
            }
          },
          additionalProperties: {
            // Color axes: { min, max, colorscale?, colorbar? }
            type: "object",
            properties: {
              min: { type: "number" },
              max: { type: "number" },
              colorscale: {
                type: "string",
                enum: [...getRegisteredColorscales().keys()]
              },
              colorbar: {
                type: "string",
                enum: ["none", "vertical", "horizontal"]
              }
            },
            required: ["min", "max"]
          }
        }
      }
    }
  }

  renderAxes() {
    if (this.axisRegistry.getScale("xaxis_bottom")) {
      const g = this.svg.select(".xaxis_bottom")
        .attr("transform", `translate(${this.margin.left},${this.margin.top + this.plotHeight})`)
        .call(axisBottom(this.axisRegistry.getScale("xaxis_bottom")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "xaxis_bottom", this.plotWidth / 2, this.margin.bottom)
    }
    if (this.axisRegistry.getScale("xaxis_top")) {
      const g = this.svg.select(".xaxis_top")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(axisTop(this.axisRegistry.getScale("xaxis_top")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "xaxis_top", this.plotWidth / 2, this.margin.top)
    }
    if (this.axisRegistry.getScale("yaxis_left")) {
      const g = this.svg.select(".yaxis_left")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(axisLeft(this.axisRegistry.getScale("yaxis_left")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_left", -this.plotHeight / 2, this.margin.left)
    }
    if (this.axisRegistry.getScale("yaxis_right")) {
      const g = this.svg.select(".yaxis_right")
        .attr("transform", `translate(${this.margin.left + this.plotWidth},${this.margin.top})`)
        .call(axisRight(this.axisRegistry.getScale("yaxis_right")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_right", -this.plotHeight / 2, this.margin.right)
    }
  }

  updateAxisLabel(axisGroup, axisName, centerPos, availableMargin) {
    const axisQuantityUnit = this.axisRegistry.axisQuantityUnits[axisName]
    if (!axisQuantityUnit) return

    const unitLabel = getAxisQuantityUnit(axisQuantityUnit).label
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
      const props = {
        xDomain: layer.xAxis ? this.axisRegistry.getScale(layer.xAxis).domain() : [0, 1],
        yDomain: layer.yAxis ? this.axisRegistry.getScale(layer.yAxis).domain() : [0, 1],
        viewport: viewport,
        count: layer.vertexCount ?? layer.attributes.x?.length ?? 0
      }

      // Add color axis uniforms
      for (const [slot, { quantityKind }] of Object.entries(layer.colorAxes)) {
        props[`colorscale_${slot}`] = this.colorAxisRegistry.getColorscaleIndex(quantityKind)
        const range = this.colorAxisRegistry.getRange(quantityKind)
        props[`color_range_${slot}`] = range ?? [0, 1]
      }

      // Add filter axis uniforms (vec4: [min, max, hasMin, hasMax])
      for (const [slot, { quantityKind }] of Object.entries(layer.filterAxes)) {
        props[`filter_range_${slot}`] = this.filterAxisRegistry.getRangeUniform(quantityKind)
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
              const domainWidth = d1 - d0
              const fraction = mousePixel / pixelSize

              if (isY) {
                gestureStartDataPos[axis] = d1 - fraction * domainWidth
              } else {
                gestureStartDataPos[axis] = d0 + fraction * domainWidth
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
            const domainWidth = d1 - d0

            const pixelSize = isY ? this.plotHeight : this.plotWidth
            const pixelDelta = isY ? deltaY : deltaX
            const zoomScale = deltaK
            const mousePixelPos = gestureStartMousePos[axis]
            const targetDataPos = gestureStartDataPos[axis]

            const newDomainWidth = domainWidth / zoomScale

            const panDomainDelta = isWheel ? 0 : (isY
              ? pixelDelta * domainWidth / pixelSize / zoomScale
              : -pixelDelta * domainWidth / pixelSize / zoomScale)

            const fraction = mousePixelPos / pixelSize
            let center

            if (isY) {
              center = (targetDataPos + panDomainDelta) + (fraction - 0.5) * newDomainWidth
            } else {
              center = (targetDataPos + panDomainDelta) + (0.5 - fraction) * newDomainWidth
            }

            const newDomain = [center - newDomainWidth / 2, center + newDomainWidth / 2]
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
