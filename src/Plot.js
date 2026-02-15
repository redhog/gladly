import reglInit from "regl"
import * as d3 from "d3-selection"
import { scaleLinear } from "d3-scale"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom, zoomIdentity } from "d3-zoom"
import { AXES, AXIS_UNITS, AxisRegistry } from "./AxisRegistry.js"
import { getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"

export class Plot {
  constructor({ container, width, height, margin = { top: 60, right: 60, bottom: 60, left: 60 }, data = {}, layers = [], axes = {} }) {
    // Create canvas element
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.canvas.style.display = 'block'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.zIndex = '1'
    container.appendChild(this.canvas)

    // Create SVG element
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0')
      .style('z-index', '2')
      .style('user-select', 'none')

    this.width = width
    this.height = height
    this.margin = margin
    this.plotWidth = width - margin.left - margin.right
    this.plotHeight = height - margin.top - margin.bottom

    this._initialize(data, layers, axes)
  }

  _initialize(data, layers, axes) {
    // Initialize regl
    this.regl = reglInit({ canvas: this.canvas })

    this.layers = []

    // SVG groups for axes
    AXES.forEach(a => this.svg.append("g").attr("class", a))

    // Create AxisRegistry internally
    this.axisRegistry = new AxisRegistry(this.plotWidth, this.plotHeight)

    // Process layers from declarative configuration
    this._processLayers(layers, data)

    // Auto-calculate domains and apply overrides
    this._setDomains(axes)

    this.initZoom()
    this.render()
  }

  update({ width, height, margin = { top: 60, right: 60, bottom: 60, left: 60 }, data = {}, layers = [], axes = {} }) {
    // Clean up existing regl context
    if (this.regl) {
      this.regl.destroy()
    }

    // Clear SVG content
    this.svg.selectAll('*').remove()

    // Update dimensions if changed
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.canvas.width = width
      this.canvas.height = height
      this.svg.attr('width', width).attr('height', height)
    }

    this.margin = margin
    this.plotWidth = width - margin.left - margin.right
    this.plotHeight = height - margin.top - margin.bottom

    // Reinitialize everything
    this._initialize(data, layers, axes)
  }

  _processLayers(layersConfig, data) {
    for (const layerSpec of layersConfig) {
      // Each layerSpec is an object with a single key-value pair: {layerTypeName: parameters}
      const entries = Object.entries(layerSpec)
      if (entries.length !== 1) {
        throw new Error("Each layer specification must have exactly one layer type key")
      }

      const [layerTypeName, parameters] = entries[0]
      const layerType = getLayerType(layerTypeName)

      // Create the layer using the layer type's factory method
      const layer = layerType.createLayer(parameters, data)

      // Register axes with the AxisRegistry
      this.axisRegistry.ensureAxis(layer.xAxis, layer.type.xUnit)
      this.axisRegistry.ensureAxis(layer.yAxis, layer.type.yUnit)

      // Create the draw command
      layer.draw = layer.type.createDrawCommand(this.regl)

      this.layers.push(layer)
    }
  }

  _setDomains(axesOverrides) {
    // Auto-calculate domain for each axis from layer data
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
        const dataArray = isXAxis ? layer.data.x : layer.data.y

        for (let i = 0; i < dataArray.length; i++) {
          const val = dataArray[i]
          if (val < min) min = val
          if (val > max) max = val
        }
      }

      autoDomains[axis] = [min, max]
    }

    // Apply domains (use override if provided, otherwise use auto-calculated)
    for (const axis of AXES) {
      const scale = this.axisRegistry.getScale(axis)
      if (scale) {
        const domain = axesOverrides[axis] || autoDomains[axis]
        if (domain) {
          scale.domain(domain)
        }
      }
    }
  }

  static schema() {
    const layerTypes = getRegisteredLayerTypes()

    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "array",
      items: {
        type: "object",
        oneOf: layerTypes.map(typeName => {
          const layerType = getLayerType(typeName)
          return {
            title: typeName,
            properties: {
              [typeName]: layerType.schema()
            },
            required: [typeName],
            additionalProperties: false
          }
        })
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
    const unit = this.axisRegistry.units[axisName]
    if (!unit) return

    const unitLabel = AXIS_UNITS[unit]?.label || unit
    const isVertical = axisName.includes("y")
    const padding = 5 // Padding from SVG edge

    // Remove existing label
    axisGroup.select(".axis-label").remove()

    // Create text element
    const text = axisGroup.append("text")
      .attr("class", "axis-label")
      .attr("fill", "#000")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "bold")

    // Handle multiline text
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

    // Apply rotation for vertical axes
    if (isVertical) {
      text.attr("transform", "rotate(-90)")
    }

    // Position at center, temporarily at y=0 to measure
    text.attr("x", centerPos).attr("y", 0)

    // Measure actual text bounds
    const bbox = text.node().getBBox()

    // Reserve space for tick marks and tick labels (approximately 25px from axis)
    const tickSpace = 25

    // Position based on actual bounds to center within available margin MINUS tick space
    // bbox.y is the top of the text bounds, bbox.height is the height
    // Text center is at: bbox.y + bbox.height / 2
    let yOffset

    if (axisName === "xaxis_bottom") {
      // Center in space between ticks and SVG bottom: [tickSpace, availableMargin]
      const centerY = tickSpace + (availableMargin - tickSpace) / 2
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "xaxis_top") {
      // Center in space between SVG top and ticks: [-availableMargin, -tickSpace]
      const centerY = -(tickSpace + (availableMargin - tickSpace) / 2)
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "yaxis_left") {
      // For rotated text, bbox is in rotated coordinates
      // Center in space between SVG left and ticks: [-availableMargin, -tickSpace]
      const centerY = -(tickSpace + (availableMargin - tickSpace) / 2)
      yOffset = centerY - (bbox.y + bbox.height / 2)
    } else if (axisName === "yaxis_right") {
      // Center in space between ticks and SVG right: [tickSpace, availableMargin]
      const centerY = tickSpace + (availableMargin - tickSpace) / 2
      yOffset = centerY - (bbox.y + bbox.height / 2)
    }

    text.attr("y", yOffset)
  }

  render() {
    this.regl.clear({ color: [1,1,1,1], depth:1 })
    const viewport = {
      x: this.margin.left,
      y: this.margin.bottom,
      width: this.plotWidth,
      height: this.plotHeight
    }
    for (const layer of this.layers) {
      layer.draw({
        data: layer.data,
        xDomain: this.axisRegistry.getScale(layer.xAxis).domain(),
        yDomain: this.axisRegistry.getScale(layer.yAxis).domain(),
        viewport: viewport,
        count: layer.data.x.length
      })
    }
    this.renderAxes()
  }

  initZoom() {
    // Create full-coverage overlay for zoom/pan events
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
    let gestureStartDomains = {} // Store domains at start of each gesture
    let gestureStartMousePos = {} // Store mouse position (pixels) at start
    let gestureStartDataPos = {} // Store data coordinates at mouse position
    let gestureStartTransform = null // Store transform at start to compute delta

    const zoomBehavior = zoom()
      .scaleExtent([0.5, 50])
      .on("start", (event) => {
        // Ignore programmatic zoom events (no sourceEvent)
        if (!event.sourceEvent) return

        gestureStartTransform = { k: event.transform.k, x: event.transform.x, y: event.transform.y }
        const [mouseX, mouseY] = d3.pointer(event.sourceEvent, this.svg.node())

        // Detect region using existing margin properties
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
          currentRegion = null // In corners - no zoom
        }

        // Store current domains, mouse position, and data coordinates at mouse
        gestureStartDomains = {}
        gestureStartMousePos = {}
        gestureStartDataPos = {}
        if (currentRegion && this.axisRegistry) {
          const axesToZoom = currentRegion === "plot_area" ? AXES : [currentRegion]
          axesToZoom.forEach(axis => {
            const scale = this.axisRegistry.getScale(axis)
            if (scale) {
              const currentDomain = scale.domain()
              gestureStartDomains[axis] = currentDomain.slice() // Clone the domain

              const isY = axis.includes("y")
              const mousePixel = isY ? (mouseY - this.margin.top) : (mouseX - this.margin.left)
              gestureStartMousePos[axis] = mousePixel

              // Calculate what data value is currently at the mouse position
              const pixelSize = isY ? this.plotHeight : this.plotWidth
              const [d0, d1] = currentDomain
              const domainWidth = d1 - d0
              const fraction = mousePixel / pixelSize

              if (isY) {
                // Y axis inverted: pixel 0 (top) = d1, pixel max (bottom) = d0
                gestureStartDataPos[axis] = d1 - fraction * domainWidth
              } else {
                // X axis normal: pixel 0 (left) = d0, pixel max (right) = d1
                gestureStartDataPos[axis] = d0 + fraction * domainWidth
              }
            }
          })
        }
      })
      .on("zoom", (event) => {
        if (!this.axisRegistry || !currentRegion || !gestureStartTransform) return

        // Calculate delta from start of this gesture
        const deltaK = event.transform.k / gestureStartTransform.k
        const deltaX = event.transform.x - gestureStartTransform.x
        const deltaY = event.transform.y - gestureStartTransform.y

        // Detect if this is a wheel event (scroll-to-zoom) vs drag
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

            // New domain width from zoom
            const newDomainWidth = domainWidth / zoomScale

            // Domain delta from pan (ignore pan for wheel events - pure zoom only)
            // Y is inverted (range is [plotHeight, 0]), so positive screen delta = positive domain delta
            // X is normal (range is [0, plotWidth]), so positive screen delta = negative domain delta
            const panDomainDelta = isWheel ? 0 : (isY
              ? pixelDelta * domainWidth / pixelSize / zoomScale
              : -pixelDelta * domainWidth / pixelSize / zoomScale)

            // Calculate new domain keeping targetDataPos at mousePixelPos
            const fraction = mousePixelPos / pixelSize
            let center

            if (isY) {
              // Y axis: inverted range [plotHeight, 0]
              // We want: newDomain[1] - (targetDataPos + panDomainDelta) = fraction * newDomainWidth
              // center + newDomainWidth/2 - targetDataPos - panDomainDelta = fraction * newDomainWidth
              // center = targetDataPos + panDomainDelta + fraction * newDomainWidth - newDomainWidth/2
              center = (targetDataPos + panDomainDelta) + (fraction - 0.5) * newDomainWidth
            } else {
              // X axis: normal range [0, plotWidth]
              // We want: (targetDataPos + panDomainDelta) - newDomain[0] = fraction * newDomainWidth
              // targetDataPos + panDomainDelta - (center - newDomainWidth/2) = fraction * newDomainWidth
              // center = targetDataPos + panDomainDelta - fraction * newDomainWidth + newDomainWidth/2
              center = (targetDataPos + panDomainDelta) + (0.5 - fraction) * newDomainWidth
            }

            const newDomain = [center - newDomainWidth / 2, center + newDomainWidth / 2]
            scale.domain(newDomain)
          }
        })

        this.render()
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
