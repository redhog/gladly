import reglInit from "regl"
import * as d3 from "d3-selection"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom } from "d3-zoom"
import { AXES, AXIS_UNITS } from "./AxisRegistry.js"

export class Plot {
  constructor({ canvas, svg, width, height, margin = { top: 20, right: 20, bottom: 50, left: 60 } }) {
    this.regl = reglInit({ canvas })
    this.svg = d3.select(svg)
    this.width = width
    this.height = height
    this.margin = margin
    this.plotWidth = width - margin.left - margin.right
    this.plotHeight = height - margin.top - margin.bottom
    this.layers = []

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
      this.updateAxisLabel(g, "xaxis_bottom", this.plotWidth / 2, 40)
    }
    if (this.axisRegistry.getScale("xaxis_top")) {
      const g = this.svg.select(".xaxis_top")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(axisTop(this.axisRegistry.getScale("xaxis_top")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "xaxis_top", this.plotWidth / 2, -30)
    }
    if (this.axisRegistry.getScale("yaxis_left")) {
      const g = this.svg.select(".yaxis_left")
        .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
        .call(axisLeft(this.axisRegistry.getScale("yaxis_left")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_left", -this.plotHeight / 2, -45)
    }
    if (this.axisRegistry.getScale("yaxis_right")) {
      const g = this.svg.select(".yaxis_right")
        .attr("transform", `translate(${this.margin.left + this.plotWidth},${this.margin.top})`)
        .call(axisRight(this.axisRegistry.getScale("yaxis_right")))
      g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
      g.selectAll(".tick line").attr("stroke", "#000")
      g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")
      this.updateAxisLabel(g, "yaxis_right", -this.plotHeight / 2, 45)
    }
  }

  updateAxisLabel(axisGroup, axisName, xPos, yPos) {
    const unit = this.axisRegistry.units[axisName]
    if (!unit) return

    const unitLabel = AXIS_UNITS[unit]?.label || unit
    const isVertical = axisName.includes("y")

    // Remove existing label
    axisGroup.select(".axis-label").remove()

    // Add new label
    const text = axisGroup.append("text")
      .attr("class", "axis-label")
      .attr("fill", "#000")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "bold")
      .text(unitLabel)

    if (isVertical) {
      text.attr("transform", "rotate(-90)")
        .attr("x", xPos)
        .attr("y", yPos)
    } else {
      text.attr("x", xPos)
        .attr("y", yPos)
    }
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
    // Zoom all axes together
    const zoomAll = zoom().scaleExtent([0.5,50]).on("zoom", (event) => {
      if (!this.axisRegistry) return
      const t = event.transform
      AXES.forEach(axis => {
        const scale = this.axisRegistry.getScale(axis)
        if (scale) {
          const range = axis.includes("y") ? [this.plotHeight,0] : [0,this.plotWidth]
          scale.domain(t.rescaleX(d3.scaleLinear().domain(scale.domain()).range(range)).domain())
        }
      })
      this.render()
    })
    d3.select(this.regl._gl.canvas).call(zoomAll)

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
        const range = axisName.includes("y") ? [this.plotHeight,0] : [0,this.plotWidth]
        axisScale.domain(t.rescaleX(d3.scaleLinear().domain(axisScale.domain()).range(range)).domain())
        this.render()
      })
      this.svg.select(`.${axisName}`).call(zoomAxis)
    })
  }
}
