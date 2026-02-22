import * as d3 from "d3-scale"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"

export const AXES = ["xaxis_bottom","xaxis_top","yaxis_left","yaxis_right"]

export class AxisRegistry {
  constructor(width, height) {
    this.scales = {}
    this.axisQuantityKinds = {}
    this.width = width
    this.height = height
    AXES.forEach(a => {
      this.scales[a] = null
      this.axisQuantityKinds[a] = null
    })
  }

  ensureAxis(axisName, axisQuantityKind, scaleOverride) {
    if (!AXES.includes(axisName)) throw new Error(`Unknown axis ${axisName}`)
    if (this.axisQuantityKinds[axisName] && this.axisQuantityKinds[axisName] !== axisQuantityKind)
      throw new Error(`Axis quantity kind mismatch on axis ${axisName}: ${this.axisQuantityKinds[axisName]} vs ${axisQuantityKind}`)

    if (!this.scales[axisName]) {
      const quantityKindDef = getAxisQuantityKind(axisQuantityKind)
      const scaleType = scaleOverride ?? quantityKindDef.scale
      this.scales[axisName] = scaleType === "log"
        ? d3.scaleLog().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
        : d3.scaleLinear().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
      this.axisQuantityKinds[axisName] = axisQuantityKind
    }
    return this.scales[axisName]
  }

  getScale(axisName) { return this.scales[axisName] }

  isLogScale(axisName) {
    const scale = this.scales[axisName]
    return !!scale && typeof scale.base === 'function'
  }

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    const autoDomains = {}

    for (const axis of AXES) {
      const layersUsingAxis = layers.filter(l => l.xAxis === axis || l.yAxis === axis)
      if (layersUsingAxis.length === 0) continue

      let min = Infinity, max = -Infinity
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
      const scale = this.getScale(axis)
      if (!scale) continue
      const override = axesOverrides[axis]
      const domain = override ? [override.min, override.max] : autoDomains[axis]
      if (domain) scale.domain(domain)
    }

    for (const axis of AXES) {
      if (!this.isLogScale(axis)) continue
      const [dMin, dMax] = this.getScale(axis).domain()
      if ((isFinite(dMin) && dMin <= 0) || (isFinite(dMax) && dMax <= 0)) {
        throw new Error(
          `Axis '${axis}' uses log scale but has non-positive domain [${dMin}, ${dMax}]. ` +
          `All data values and min/max must be > 0 for log scale.`
        )
      }
    }
  }

  setScaleType(axisName, scaleType) {
    const scale = this.scales[axisName]
    if (!scale) return
    const currentIsLog = typeof scale.base === 'function'
    const wantLog = scaleType === "log"
    if (currentIsLog === wantLog) return
    const currentDomain = scale.domain()
    const newScale = wantLog
      ? d3.scaleLog().range(axisName.includes("y") ? [this.height, 0] : [0, this.width])
      : d3.scaleLinear().range(axisName.includes("y") ? [this.height, 0] : [0, this.width])
    newScale.domain(currentDomain)
    this.scales[axisName] = newScale
  }
}
