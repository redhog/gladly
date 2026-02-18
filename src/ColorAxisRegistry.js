import { getAxisQuantityKind } from './AxisQuantityKindRegistry.js'
import { getColorscaleIndex } from './ColorscaleRegistry.js'

export class ColorAxisRegistry {
  constructor() {
    this._axes = new Map()
  }

  ensureColorAxis(quantityKind, colorscaleOverride = null) {
    if (!this._axes.has(quantityKind)) {
      this._axes.set(quantityKind, { colorscaleOverride, range: null })
    } else if (colorscaleOverride !== null) {
      this._axes.get(quantityKind).colorscaleOverride = colorscaleOverride
    }
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
}
