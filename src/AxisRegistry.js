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
