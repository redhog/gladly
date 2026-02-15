import reglInit from "regl"
import * as d3 from "d3-selection"
import { scaleLinear } from "d3-scale"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom } from "d3-zoom"
import { AXES, AXIS_UNITS } from "./AxisRegistry.js"

export class Plot {
  constructor({ canvas, svg, width, height, margin = { top: 60, right: 60, bottom: 60, left: 60 } }) {
    this.regl = reglInit({ canvas })
    this.svg = d3.select(svg)
    this.width = width
    this.height = height
    this.margin = margin
    this.plotWidth = width - margin.left - margin.right
    this.plotHeight = height - margin.top - margin.bottom
    this.layers = []

    // Create transparent overlay for zoom/pan events
    this.plotArea = this.svg.append("rect")
      .attr("class", "plot-area")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", this.plotWidth)
      .attr("height", this.plotHeight)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "move")

    // SVG groups for axes
    AXES.forEach(a => this.svg.append("g").attr("class", a))

    this.axisRegistry = null
    this.initZoom()
  }

  setAxisRegistry(axisRegistry) {
    this.axisRegistry = axisRegistry
    this.setupAxisZoom()
  }

  addLayer(layer) {
    const xScale = this.axisRegistry.ensureAxis(layer.xAxis, layer.type.xUnit)
    const yScale = this.axisRegistry.ensureAxis(layer.yAxis, layer.type.yUnit)
    layer.draw = layer.type.createDrawCommand(this.regl)
    this.layers.push(layer)
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
    console.log("initZoom called, plotArea:", this.plotArea)
    // Zoom all axes together - attach to plot area overlay
    const zoomAll = zoom().scaleExtent([0.5,50]).on("zoom", (event) => {
      console.log("Zoom event fired:", event.transform)
      if (!this.axisRegistry) {
        console.log("No axis registry yet")
        return
      }
      const t = event.transform
      AXES.forEach(axis => {
        const scale = this.axisRegistry.getScale(axis)
        console.log(`Axis ${axis}:`, scale ? scale.domain() : "no scale")
        if (scale) {
          const isY = axis.includes("y")
          const range = isY ? [this.plotHeight,0] : [0,this.plotWidth]
          const tempScale = scaleLinear().domain(scale.domain()).range(range)
          const newDomain = isY ? t.rescaleY(tempScale).domain() : t.rescaleX(tempScale).domain()
          console.log(`  New domain: [${newDomain}]`)
          scale.domain(newDomain)
        }
      })
      this.render()
    })
    console.log("Attaching zoom to plotArea")
    this.plotArea.call(zoomAll)
    console.log("Zoom attached")

    // Axis-specific zoom setup will happen when axis registry is set
  }

  setupAxisZoom() {
    // Axis-specific zoom
    if (!this.axisRegistry) return
    AXES.forEach(axisName => {
      const axisScale = this.axisRegistry.getScale(axisName)
      if (!axisScale) return
      const zoomAxis = zoom().scaleExtent([0.5,50]).on("zoom", (event) => {
        const t = event.transform
        const isY = axisName.includes("y")
        const range = isY ? [this.plotHeight,0] : [0,this.plotWidth]
        const tempScale = scaleLinear().domain(axisScale.domain()).range(range)
        const newDomain = isY ? t.rescaleY(tempScale).domain() : t.rescaleX(tempScale).domain()
        axisScale.domain(newDomain)
        this.render()
      })
      this.svg.select(`.${axisName}`).call(zoomAxis)
    })
  }
}
