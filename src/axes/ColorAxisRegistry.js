import { getAxisQuantityKind, getScaleTypeFloat } from './AxisQuantityKindRegistry.js'
import { getColorscaleIndex } from '../colorscales/ColorscaleRegistry.js'

export class ColorAxisRegistry {
  constructor() {
    this._axes = new Map()
  }

  ensureColorAxis(quantityKind, colorscaleOverride = null) {
    if (!this._axes.has(quantityKind)) {
      this._axes.set(quantityKind, { colorscaleOverride, range: null, alphaBlend: 0.0 })
    } else if (colorscaleOverride !== null) {
      this._axes.get(quantityKind).colorscaleOverride = colorscaleOverride
    }
  }

  getAlphaBlend(quantityKind) {
    return this._axes.get(quantityKind)?.alphaBlend ?? 0.0
  }

  setRange(quantityKind, min, max) {
    if (!this._axes.has(quantityKind)) {
      throw new Error(`Color axis '${quantityKind}' not found in registry`)
    }
    this._axes.get(quantityKind).range = [min, max]
  }

  getRange(quantityKind) {
    return this._axes.get(quantityKind)?.range ?? null
  }

  getColorscale(quantityKind) {
    const entry = this._axes.get(quantityKind)
    if (!entry) return null
    if (entry.colorscaleOverride) return entry.colorscaleOverride
    const unitDef = getAxisQuantityKind(quantityKind)
    return unitDef.colorscale ?? null
  }

  getColorscaleIndex(quantityKind) {
    const colorscale = this.getColorscale(quantityKind)
    if (colorscale === null) return 0
    return getColorscaleIndex(colorscale)
  }

  hasAxis(quantityKind) {
    return this._axes.has(quantityKind)
  }

  getQuantityKinds() {
    return Array.from(this._axes.keys())
  }

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    for (const quantityKind of this.getQuantityKinds()) {
      const override = axesOverrides[quantityKind]
      if (override?.colorscale && override?.colorscale != "none")
        this.ensureColorAxis(quantityKind, override.colorscale)
      if (override?.alpha_blend !== undefined)
        this._axes.get(quantityKind).alphaBlend = override.alpha_blend
      
      let min = Infinity, max = -Infinity

      for (const layer of layers) {
        for (const qk of Object.values(layer.colorAxes)) {
          if (qk !== quantityKind) continue
          if (layer.domains[qk] !== undefined) {
            const [dMin, dMax] = layer.domains[qk]
            if (dMin < min) min = dMin
            if (dMax > max) max = dMax
          } else {
            const data = layer.attributes[qk]
            if (!data) continue
            for (let i = 0; i < data.length; i++) {
              if (data[i] < min) min = data[i]
              if (data[i] > max) max = data[i]
            }
          }
        }
      }

      if (min !== Infinity) {
        this.setRange(quantityKind, override?.min ?? min, override?.max ?? max)
      }
    }

    for (const quantityKind of this.getQuantityKinds()) {
      if (getScaleTypeFloat(quantityKind, axesOverrides) <= 0.5) continue
      const range = this.getRange(quantityKind)
      if (!range) continue
      if (range[0] <= 0 || range[1] <= 0) {
        throw new Error(
          `Color axis '${quantityKind}' uses log scale but has non-positive range [${range[0]}, ${range[1]}]. ` +
          `All data values and min/max must be > 0 for log scale.`
        )
      }
    }
  }
}
