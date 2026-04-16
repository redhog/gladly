import { Plot } from "../core/Plot.js"
import { getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { linkAxes } from "../axes/AxisLink.js"
import "../layers/ColorbarLayer.js"

const DRAG_BAR_HEIGHT = 12

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

    // Link the colorbar's spatial axis to the target's color axis.
    // Zooming the colorbar propagates domain changes to the target's color range.
    this._spatialLink = linkAxes(this.axes[this._spatialAxis], targetPlot.axes[colorAxisName])

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

    this._minLabel = makeLabel('open min bound')
    this._maxLabel = makeLabel('open max bound')
    this._minInput = this._minLabel.querySelector('input')
    this._maxInput = this._maxLabel.querySelector('input')

    if (this._orientation === 'horizontal') {
      Object.assign(this._minLabel.style, { left: '2px', bottom: '2px' })
      Object.assign(this._maxLabel.style, { right: '2px', bottom: '2px' })
    } else {
      Object.assign(this._maxLabel.style, { top: '2px', left: '2px' })
      Object.assign(this._minLabel.style, { bottom: '2px', left: '2px' })
    }

    this.container.appendChild(this._minLabel)
    this.container.appendChild(this._maxLabel)

    this._minInput.addEventListener('change', () => this._onCheckboxChange())
    this._maxInput.addEventListener('change', () => this._onCheckboxChange())
  }

  _onCheckboxChange() {
    const registry = this._targetPlot.colorAxisRegistry
    if (!registry) return
    registry.setClamp(
      this._colorAxisName,
      this._minInput.checked,
      this._maxInput.checked
    )
    this._targetPlot.scheduleRender()
  }

  _getScaleTypeFloat(quantityKind) {
    if (quantityKind === this._colorAxisName && this._targetPlot) {
      return getScaleTypeFloat(quantityKind, this._targetPlot.currentConfig?.axes)
    }
    return super._getScaleTypeFloat(quantityKind)
  }

  render() {
    // Always pull the current range, colorscale, and scale type from the target plot so the
    // colorbar stays in sync even after config changes or resizes.
    if (this.colorAxisRegistry && this.axisRegistry && this._targetPlot) {
      const range = this._targetPlot.getAxisDomain(this._colorAxisName)
      if (range) {
        this.setAxisDomain(this._spatialAxis, range)
        this.setAxisDomain(this._colorAxisName, range)
      }
      const colorscale = this._targetPlot.colorAxisRegistry?.getColorscale(this._colorAxisName)
      if (colorscale) this.colorAxisRegistry.ensureColorAxis(this._colorAxisName, colorscale)
      const scaleType = getScaleTypeFloat(this._colorAxisName, this._targetPlot.currentConfig?.axes) > 0.5 ? "log" : "linear"
      this.axisRegistry.setScaleType(this._spatialAxis, scaleType)

      const clampMin = this._targetPlot.colorAxisRegistry?.getClampMin(this._colorAxisName) ?? true
      const clampMax = this._targetPlot.colorAxisRegistry?.getClampMax(this._colorAxisName) ?? true
      if (this._minInput) this._minInput.checked = clampMin
      if (this._maxInput) this._maxInput.checked = clampMax
    }
    super.render()
  }

  destroy() {
    this._spatialLink.unlink()
    this._targetPlot._renderCallbacks.delete(this._syncCallback)
    super.destroy()
  }
}

// Register the colorbar float factory so Plot._syncFloats can create colorbar floats.
Plot.registerFloatFactory('colorbar', {
  factory: (parentPlot, container, opts) =>
    new Colorbar(container, parentPlot, opts.axisName, { orientation: opts.orientation }),
  defaultSize: (opts) => {
    const h = opts.orientation === 'horizontal' ? 70 + DRAG_BAR_HEIGHT : 220 + DRAG_BAR_HEIGHT
    const w = opts.orientation === 'horizontal' ? 220 : 70
    return { width: w, height: h }
  }
})
