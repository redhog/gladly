import * as d3 from "d3-selection"
import { zoom } from "d3-zoom"
import { AXES } from "./AxisRegistry.js"

export class ZoomController {
  constructor(plot) {
    this._plot = plot
    this._init()
  }

  _init() {
    const plot = this._plot

    const fullOverlay = plot.svg.append("rect")
      .attr("class", "zoom-overlay")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", plot.width)
      .attr("height", plot.height)
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
        const [mouseX, mouseY] = d3.pointer(event.sourceEvent, plot.svg.node())
        const { margin, plotWidth, plotHeight } = plot

        const inPlotX = mouseX >= margin.left && mouseX < margin.left + plotWidth
        const inPlotY = mouseY >= margin.top && mouseY < margin.top + plotHeight

        if (inPlotX && mouseY < margin.top) {
          currentRegion = "xaxis_top"
        } else if (inPlotX && mouseY >= margin.top + plotHeight) {
          currentRegion = "xaxis_bottom"
        } else if (inPlotY && mouseX < margin.left) {
          currentRegion = "yaxis_left"
        } else if (inPlotY && mouseX >= margin.left + plotWidth) {
          currentRegion = "yaxis_right"
        } else if (inPlotX && inPlotY) {
          currentRegion = "plot_area"
        } else {
          currentRegion = null
        }

        gestureStartDomains = {}
        gestureStartMousePos = {}
        gestureStartDataPos = {}

        if (currentRegion && plot.axisRegistry) {
          const axesToZoom = currentRegion === "plot_area" ? AXES : [currentRegion]
          axesToZoom.forEach(axis => {
            const scale = plot.axisRegistry.getScale(axis)
            if (!scale) return

            const { margin, plotWidth, plotHeight } = plot
            const isY = axis.includes("y")
            const mousePixel = isY ? (mouseY - margin.top) : (mouseX - margin.left)
            const pixelSize = isY ? plotHeight : plotWidth
            const currentDomain = scale.domain()
            gestureStartDomains[axis] = currentDomain.slice()
            gestureStartMousePos[axis] = mousePixel

            const isLog = plot.axisRegistry.isLogScale(axis)
            const [d0, d1] = currentDomain
            const t0 = isLog ? Math.log(d0) : d0
            const t1 = isLog ? Math.log(d1) : d1
            const fraction = mousePixel / pixelSize
            gestureStartDataPos[axis] = isY
              ? t1 - fraction * (t1 - t0)
              : t0 + fraction * (t1 - t0)
          })
        }
      })
      .on("zoom", (event) => {
        if (!plot.axisRegistry || !currentRegion || !gestureStartTransform) return

        const deltaK = event.transform.k / gestureStartTransform.k
        const deltaX = event.transform.x - gestureStartTransform.x
        const deltaY = event.transform.y - gestureStartTransform.y
        const isWheel = event.sourceEvent && event.sourceEvent.type === 'wheel'
        const axesToZoom = currentRegion === "plot_area" ? AXES : [currentRegion]

        axesToZoom.forEach(axis => {
          const scale = plot.axisRegistry.getScale(axis)
          if (!scale || !gestureStartDomains[axis] || gestureStartDataPos[axis] === undefined) return

          const { plotWidth, plotHeight } = plot
          const isY = axis.includes("y")
          const [d0, d1] = gestureStartDomains[axis]
          const isLog = plot.axisRegistry.isLogScale(axis)
          const t0 = isLog ? Math.log(d0) : d0
          const t1 = isLog ? Math.log(d1) : d1
          const tDomainWidth = t1 - t0

          const pixelSize = isY ? plotHeight : plotWidth
          const pixelDelta = isY ? deltaY : deltaX
          const newTDomainWidth = tDomainWidth / deltaK
          const targetDataPos = gestureStartDataPos[axis]
          const mousePixelPos = gestureStartMousePos[axis]
          const fraction = mousePixelPos / pixelSize

          const panTDomainDelta = isWheel ? 0 : (isY
            ? pixelDelta * tDomainWidth / pixelSize / deltaK
            : -pixelDelta * tDomainWidth / pixelSize / deltaK)

          const tCenter = isY
            ? (targetDataPos + panTDomainDelta) + (fraction - 0.5) * newTDomainWidth
            : (targetDataPos + panTDomainDelta) + (0.5 - fraction) * newTDomainWidth

          const newTDomain = [tCenter - newTDomainWidth / 2, tCenter + newTDomainWidth / 2]
          const newDomain = isLog
            ? [Math.exp(newTDomain[0]), Math.exp(newTDomain[1])]
            : newTDomain

          plot._getAxis(axis).setDomain(newDomain)
        })

        plot.scheduleRender()
      })
      .on("end", () => {
        currentRegion = null
        gestureStartDomains = {}
        gestureStartMousePos = {}
        gestureStartDataPos = {}
        gestureStartTransform = null
        plot._zoomEndCallbacks.forEach(cb => cb())
      })

    fullOverlay.call(zoomBehavior)
  }
}
