import * as d3 from "d3-scale"
import { getAxisQuantityUnit } from "./AxisQuantityUnitRegistry.js"

export const AXES = ["xaxis_bottom","xaxis_top","yaxis_left","yaxis_right"]

export class AxisRegistry {
  constructor(width, height) {
    this.scales = {}
    this.axisQuantityUnits = {}
    this.width = width
    this.height = height
    AXES.forEach(a => {
      this.scales[a] = null
      this.axisQuantityUnits[a] = null
    })
  }

  ensureAxis(axisName, axisQuantityUnit) {
    if (!AXES.includes(axisName)) throw `Unknown axis ${axisName}`
    if (this.axisQuantityUnits[axisName] && this.axisQuantityUnits[axisName] !== axisQuantityUnit)
      throw `Axis quantity unit mismatch on axis ${axisName}: ${this.axisQuantityUnits[axisName]} vs ${axisQuantityUnit}`

    if (!this.scales[axisName]) {
      const quantityUnitDef = getAxisQuantityUnit(axisQuantityUnit)
      const scaleType = quantityUnitDef.scale
      this.scales[axisName] = scaleType === "log"
        ? d3.scaleLog().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
        : d3.scaleLinear().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
      this.axisQuantityUnits[axisName] = axisQuantityUnit
    }
    return this.scales[axisName]
  }

  getScale(axisName) { return this.scales[axisName] }
}
