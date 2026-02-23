import { Plot } from "./Plot.js"
import { getScaleTypeFloat } from "./AxisQuantityKindRegistry.js"
import { linkAxes } from "./AxisLink.js"
import "./ColorbarLayer2d.js"

const DRAG_BAR_HEIGHT = 12

// Margins leave room for tick labels on both spatial axes.
const DEFAULT_MARGIN = { top: 10, right: 50, bottom: 45, left: 55 }

export class Colorbar2d extends Plot {
  constructor(container, targetPlot, xAxis, yAxis, { margin } = {}) {
    super(container, { margin: margin ?? DEFAULT_MARGIN })

    this._targetPlot = targetPlot
    this._xAxis = xAxis
    this._yAxis = yAxis

    this.update({
      data: {},
      config: {
        layers: [{ colorbar2d: { xAxis, yAxis } }]
      }
    })

    // Link the colorbar's spatial axes to the target's color axes so zoom/pan propagates.
    this._xLink = linkAxes(this.axes["xaxis_bottom"], targetPlot.axes[xAxis])
    this._yLink = linkAxes(this.axes["yaxis_left"],   targetPlot.axes[yAxis])

    // Re-render (with sync) whenever the target plot renders.
    this._syncCallback = () => this.render()
    targetPlot._renderCallbacks.add(this._syncCallback)
  }

  _getScaleTypeFloat(quantityKind) {
    if ((quantityKind === this._xAxis || quantityKind === this._yAxis) && this._targetPlot) {
      return getScaleTypeFloat(quantityKind, this._targetPlot.currentConfig?.axes)
    }
    return super._getScaleTypeFloat(quantityKind)
  }

  render() {
    // Sync range, colorscale, and scale type for both color axes from the target plot.
    if (this.colorAxisRegistry && this.axisRegistry && this._targetPlot) {
      for (const [colorAxisName, spatialAxisId] of [
        [this._xAxis, "xaxis_bottom"],
        [this._yAxis, "yaxis_left"]
      ]) {
        const range = this._targetPlot.getAxisDomain(colorAxisName)
        if (range) {
          this.setAxisDomain(spatialAxisId, range)
          this.setAxisDomain(colorAxisName, range)
        }
        const colorscale = this._targetPlot.colorAxisRegistry?.getColorscale(colorAxisName)
        if (colorscale) this.colorAxisRegistry.ensureColorAxis(colorAxisName, colorscale)
        const scaleType = getScaleTypeFloat(colorAxisName, this._targetPlot.currentConfig?.axes) > 0.5 ? "log" : "linear"
        this.axisRegistry.setScaleType(spatialAxisId, scaleType)
      }
    }
    super.render()
  }

  destroy() {
    this._xLink.unlink()
    this._yLink.unlink()
    this._targetPlot._renderCallbacks.delete(this._syncCallback)
    super.destroy()
  }
}

// Register the colorbar2d float factory so Plot._syncFloats can create 2D colorbar floats.
// Default size is square since both axes carry equal weight.
Plot.registerFloatFactory('colorbar2d', {
  factory: (parentPlot, container, opts) =>
    new Colorbar2d(container, parentPlot, opts.xAxis, opts.yAxis),
  defaultSize: () => ({ width: 250, height: 250 + DRAG_BAR_HEIGHT })
})
