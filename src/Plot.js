import reglInit from "regl"
import * as d3 from "d3-selection"
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { zoom } from "d3-zoom"
import { AXES } from "./AxisRegistry.js"

export class Plot {
  constructor({ canvas, svg, width, height }) {
    this.regl = reglInit({ canvas })
    this.svg = d3.select(svg)
    this.width = width
    this.height = height
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
    if (this.axisRegistry.getScale("xaxis_bottom"))
      this.svg.select(".xaxis_bottom").call(axisBottom(this.axisRegistry.getScale("xaxis_bottom")))
    if (this.axisRegistry.getScale("xaxis_top"))
      this.svg.select(".xaxis_top").call(axisTop(this.axisRegistry.getScale("xaxis_top")))
    if (this.axisRegistry.getScale("yaxis_left"))
      this.svg.select(".yaxis_left").call(axisLeft(this.axisRegistry.getScale("yaxis_left")))
    if (this.axisRegistry.getScale("yaxis_right"))
      this.svg.select(".yaxis_right").call(axisRight(this.axisRegistry.getScale("yaxis_right")))
  }

  render() {
    this.regl.clear({ color: [1,1,1,1], depth:1 })
    for (const layer of this.layers) {
      layer.draw({
        data: layer.data,
        xDomain: this.axisRegistry.getScale(layer.xAxis).domain(),
        yDomain: this.axisRegistry.getScale(layer.yAxis).domain(),
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
          const range = axis.includes("y") ? [this.height,0] : [0,this.width]
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
        const range = axisName.includes("y") ? [this.height,0] : [0,this.width]
        axisScale.domain(t.rescaleX(d3.scaleLinear().domain(axisScale.domain()).range(range)).domain())
        this.render()
      })
      this.svg.select(`.${axisName}`).call(zoomAxis)
    })
  }
}
