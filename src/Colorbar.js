import { Plot } from "./Plot.js"
import { linkAxes } from "./AxisLink.js"
import "./ColorbarLayer.js"

const DEFAULT_MARGINS = {
  horizontal: { top: 5, right: 40, bottom: 45, left: 40 },
  vertical:   { top: 40, right: 10, bottom: 40, left: 50 }
}

export class Colorbar extends Plot {
  constructor(container, targetPlot, colorAxisName, { orientation = "horizontal", margin } = {}) {
    super(container, { margin: margin ?? DEFAULT_MARGINS[orientation] })

    this._targetPlot = targetPlot
    this._colorAxisName = colorAxisName
    this._orientation = orientation
    this._spatialAxis = orientation === "horizontal" ? "xaxis_bottom" : "yaxis_left"

    this.update({
      data: {},
      config: {
        layers: [{ colorbar: { colorAxis: colorAxisName, orientation } }]
      }
    })

    // Link the colorbar's spatial axis to the target's color axis for unit validation.
    this._spatialLink = linkAxes(this, this._spatialAxis, targetPlot, colorAxisName)

    // Re-render (with sync) whenever the target plot renders.
    this._syncCallback = () => this.render()
    targetPlot._renderCallbacks.add(this._syncCallback)
  }

  render() {
    // Always pull the current range and colorscale from the target plot so the
    // colorbar stays in sync even after config changes or resizes.
    if (this.colorAxisRegistry && this.axisRegistry && this._targetPlot) {
      const range = this._targetPlot.getAxisDomain(this._colorAxisName)
      if (range) {
        this.setAxisDomain(this._spatialAxis, range)
        this.setAxisDomain(this._colorAxisName, range)
      }
      const colorscale = this._targetPlot.colorAxisRegistry?.getColorscale(this._colorAxisName)
      if (colorscale) this.colorAxisRegistry.ensureColorAxis(this._colorAxisName, colorscale)
    }
    super.render()
  }

  destroy() {
    this._targetPlot._renderCallbacks.delete(this._syncCallback)
    super.destroy()
  }
}
