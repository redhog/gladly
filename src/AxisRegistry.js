import * as d3 from "d3-scale"

export const AXES = ["xaxis_bottom","xaxis_top","yaxis_left","yaxis_right"]

export const AXIS_UNITS = {
  meters: { label: "Meters", scale: "linear" },
  volts: { label: "Volts", scale: "linear" },
  log10: { label: "Log10", scale: "log" }
}

export class AxisRegistry {
  constructor(width, height) {
    this.scales = {}
    this.units = {}
    this.width = width
    this.height = height
    AXES.forEach(a => {
      this.scales[a] = null
      this.units[a] = null
    })
  }

  ensureAxis(axisName, unit) {
    if (!AXES.includes(axisName)) throw `Unknown axis ${axisName}`
    if (this.units[axisName] && this.units[axisName] !== unit)
      throw `Unit mismatch on axis ${axisName}: ${this.units[axisName]} vs ${unit}`

    if (!this.scales[axisName]) {
      const scaleType = AXIS_UNITS[unit].scale
      this.scales[axisName] = scaleType === "log"
        ? d3.scaleLog().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
        : d3.scaleLinear().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
      this.units[axisName] = unit
    }
    return this.scales[axisName]
  }

  getScale(axisName) { return this.scales[axisName] }
}
