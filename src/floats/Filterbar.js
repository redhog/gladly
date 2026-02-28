import { Plot } from "../core/Plot.js"
import { getScaleTypeFloat } from "../axes/AxisQuantityKindRegistry.js"
import { linkAxes } from "../axes/AxisLink.js"
import "../layers/FilterbarLayer.js"

const DRAG_BAR_HEIGHT = 12

const DEFAULT_MARGINS = {
  horizontal: { top: 5, right: 40, bottom: 45, left: 40 },
  vertical:   { top: 30, right: 10, bottom: 30, left: 50 }
}

export class Filterbar extends Plot {
  constructor(container, targetPlot, filterAxisName, { orientation = "horizontal", margin } = {}) {
    super(container, { margin: margin ?? DEFAULT_MARGINS[orientation] })

    this._targetPlot     = targetPlot
    this._filterAxisName = filterAxisName
    this._orientation    = orientation
    this._spatialAxis    = orientation === "horizontal" ? "xaxis_bottom" : "yaxis_left"

    this.update({
      data: {},
      config: {
        layers: [{ filterbar: { filterAxis: filterAxisName, orientation } }]
      }
    })

    // Link the filterbar's spatial axis to the target's filter axis.
    // Zoom/pan on the filterbar propagates back to update the filter range.
    this._spatialLink = linkAxes(this.axes[this._spatialAxis], targetPlot.axes[filterAxisName])

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
    const registry = this._targetPlot.filterAxisRegistry
    if (!registry) return

    const range   = registry.getRange(this._filterAxisName)
    const current = this.getAxisDomain(this._spatialAxis)
    const extent  = registry.getDataExtent(this._filterAxisName)

    const minOpen = this._minInput.checked
    const maxOpen = this._maxInput.checked

    // When closing an open bound, use the current filterbar view edge so
    // unchecking ∞ restores whatever the filterbar is currently displaying.
    const currentMin = range?.min ?? current?.[0] ?? (extent ? extent[0] : 0)
    const currentMax = range?.max ?? current?.[1] ?? (extent ? extent[1] : 1)

    registry.setRange(
      this._filterAxisName,
      minOpen ? null : currentMin,
      maxOpen ? null : currentMax
    )
    this._targetPlot.scheduleRender()
  }

  render() {
    if (this.axisRegistry && this._targetPlot) {
      const registry = this._targetPlot.filterAxisRegistry
      if (registry) {
        const range  = registry.getRange(this._filterAxisName)
        const extent = registry.getDataExtent(this._filterAxisName)
        if (range) {
          // For open bounds, keep the current axis edge so toggling ∞ does not
          // shift the filterbar's view. Fall back to data extent only on the
          // initial render when the axis has no domain yet.
          const current = this.getAxisDomain(this._spatialAxis)
          const displayMin = range.min ?? current?.[0] ?? (extent ? extent[0] : 0)
          const displayMax = range.max ?? current?.[1] ?? (extent ? extent[1] : 1)
          if (displayMin < displayMax) {
            this.setAxisDomain(this._spatialAxis, [displayMin, displayMax])
          }
          if (this._minInput) this._minInput.checked = range.min === null
          if (this._maxInput) this._maxInput.checked = range.max === null
        }
      }
      const scaleType = getScaleTypeFloat(this._filterAxisName, this._targetPlot.currentConfig?.axes) > 0.5 ? "log" : "linear"
      this.axisRegistry.setScaleType(this._spatialAxis, scaleType)
    }
    super.render()
  }

  destroy() {
    this._spatialLink.unlink()
    this._targetPlot._renderCallbacks.delete(this._syncCallback)
    super.destroy()
  }
}

// Register the filterbar float factory so Plot._syncFloats can create filterbar floats.
Plot.registerFloatFactory('filterbar', {
  factory: (parentPlot, container, opts) =>
    new Filterbar(container, parentPlot, opts.axisName, { orientation: opts.orientation }),
  defaultSize: (opts) => {
    const h = opts.orientation === 'horizontal' ? 70 + DRAG_BAR_HEIGHT : 220 + DRAG_BAR_HEIGHT
    const w = opts.orientation === 'horizontal' ? 220 : 80
    return { width: w, height: h }
  }
})
