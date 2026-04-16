import { Plot } from "../core/Plot.js"
import { getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { linkAxes } from "../axes/AxisLink.js"
import "../layers/ColorbarLayer2d.js"

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

    this._addCheckboxOverlays()
  }

  _addCheckboxOverlays() {
    const makeLabel = (title) => {
      const label = document.createElement('label')
      Object.assign(label.style, {
        position:      'absolute',
        zIndex:        '3',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           '2px',
        fontSize:      '11px',
        color:         '#555',
        cursor:        'pointer',
        userSelect:    'none'
      })
      label.title = title
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = true
      Object.assign(cb.style, { margin: '0', cursor: 'pointer' })
      const span = document.createElement('span')
      span.textContent = '∞'
      label.appendChild(cb)
      label.appendChild(span)
      return label
    }

    this._xMinLabel = makeLabel('open x min bound')
    this._xMaxLabel = makeLabel('open x max bound')
    this._yMinLabel = makeLabel('open y min bound')
    this._yMaxLabel = makeLabel('open y max bound')

    this._xMinInput = this._xMinLabel.querySelector('input')
    this._xMaxInput = this._xMaxLabel.querySelector('input')
    this._yMinInput = this._yMinLabel.querySelector('input')
    this._yMaxInput = this._yMaxLabel.querySelector('input')

    // x axis runs horizontally: min bottom-left (shifted right to avoid y-min), max bottom-right
    // y axis runs vertically: min bottom-left, max top-left
    Object.assign(this._xMinLabel.style, { bottom: '2px', left: '30px' })
    Object.assign(this._xMaxLabel.style, { bottom: '2px', right: '2px' })
    Object.assign(this._yMinLabel.style, { bottom: '2px', left: '2px' })
    Object.assign(this._yMaxLabel.style, { top: '2px',    left: '2px' })

    this.container.appendChild(this._xMinLabel)
    this.container.appendChild(this._xMaxLabel)
    this.container.appendChild(this._yMinLabel)
    this.container.appendChild(this._yMaxLabel)

    this._xMinInput.addEventListener('change', () => this._onCheckboxChange())
    this._xMaxInput.addEventListener('change', () => this._onCheckboxChange())
    this._yMinInput.addEventListener('change', () => this._onCheckboxChange())
    this._yMaxInput.addEventListener('change', () => this._onCheckboxChange())
  }

  _onCheckboxChange() {
    const registry = this._targetPlot.colorAxisRegistry
    if (!registry) return
    registry.setClamp(this._xAxis, this._xMinInput.checked, this._xMaxInput.checked)
    registry.setClamp(this._yAxis, this._yMinInput.checked, this._yMaxInput.checked)
    this._targetPlot.scheduleRender()
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

      const reg = this._targetPlot.colorAxisRegistry
      if (this._xMinInput) this._xMinInput.checked = reg?.getClampMin(this._xAxis) ?? true
      if (this._xMaxInput) this._xMaxInput.checked = reg?.getClampMax(this._xAxis) ?? true
      if (this._yMinInput) this._yMinInput.checked = reg?.getClampMin(this._yAxis) ?? true
      if (this._yMaxInput) this._yMaxInput.checked = reg?.getClampMax(this._yAxis) ?? true
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
