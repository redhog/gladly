import { AXES } from "./AxisRegistry.js"

export class AxisLink {
  constructor(plot1, axis1, plot2, axis2) {
    // Validate axis names
    if (!AXES.includes(axis1)) {
      throw new Error(`Invalid axis name: ${axis1}`)
    }
    if (!AXES.includes(axis2)) {
      throw new Error(`Invalid axis name: ${axis2}`)
    }

    this.plot1 = plot1
    this.axis1 = axis1
    this.plot2 = plot2
    this.axis2 = axis2

    // Register with both plots
    this.plot1._addAxisLink(this.axis1, this)
    this.plot2._addAxisLink(this.axis2, this)
  }

  unlink() {
    if (this.plot1) {
      this.plot1._removeAxisLink(this.axis1, this)
    }
    if (this.plot2) {
      this.plot2._removeAxisLink(this.axis2, this)
    }
    this.plot1 = null
    this.plot2 = null
  }

  // Get the other end of the link given one plot and axis
  getLinkedAxis(plot, axis) {
    if (plot === this.plot1 && axis === this.axis1) {
      return { plot: this.plot2, axis: this.axis2 }
    }
    if (plot === this.plot2 && axis === this.axis2) {
      return { plot: this.plot1, axis: this.axis1 }
    }
    return null
  }
}

export function linkAxes(plot1, axis1, plot2, axis2) {
  return new AxisLink(plot1, axis1, plot2, axis2)
}
