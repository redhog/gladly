import { getScaleTypeFloat } from './AxisQuantityKindRegistry.js'

export class FilterAxisRegistry {
  constructor() {
    // quantityKind -> { min: number|null, max: number|null, dataExtent: [number,number]|null }
    this._axes = new Map()
  }

  ensureFilterAxis(quantityKind) {
    if (!this._axes.has(quantityKind)) {
      this._axes.set(quantityKind, { min: null, max: null, dataExtent: null })
    }
  }

  setRange(quantityKind, min, max) {
    if (!this._axes.has(quantityKind)) {
      throw new Error(`Filter axis '${quantityKind}' not found in registry`)
    }
    this._axes.get(quantityKind).min = min
    this._axes.get(quantityKind).max = max
  }

  getRange(quantityKind) {
    const entry = this._axes.get(quantityKind)
    if (!entry) return null
    return { min: entry.min, max: entry.max }
  }

  // Returns [min, max, hasMin, hasMax] for use as a vec4 uniform.
  // Open bounds (null) are encoded with the corresponding flag set to 0.0.
  getRangeUniform(quantityKind) {
    const range = this.getRange(quantityKind)
    if (!range) return [0.0, 0.0, 0.0, 0.0]
    return [
      range.min ?? 0.0,
      range.max ?? 0.0,
      range.min !== null ? 1.0 : 0.0,
      range.max !== null ? 1.0 : 0.0
    ]
  }

  // Store the min/max extent of the actual per-point data (used by Filterbar for display).
  setDataExtent(quantityKind, min, max) {
    if (!this._axes.has(quantityKind)) {
      throw new Error(`Filter axis '${quantityKind}' not found in registry`)
    }
    this._axes.get(quantityKind).dataExtent = [min, max]
  }

  // Returns [min, max] extent of the raw data, or null if not yet computed.
  getDataExtent(quantityKind) {
    return this._axes.get(quantityKind)?.dataExtent ?? null
  }

  hasAxis(quantityKind) {
    return this._axes.has(quantityKind)
  }

  getQuantityKinds() {
    return Array.from(this._axes.keys())
  }

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    for (const quantityKind of this.getQuantityKinds()) {
      let extMin = Infinity, extMax = -Infinity

      for (const layer of layers) {
        for (const qk of layer.filterAxes) {
          if (qk !== quantityKind) continue
          if (layer.domains[qk] !== undefined) {
            const [dMin, dMax] = layer.domains[qk]
            if (dMin < extMin) extMin = dMin
            if (dMax > extMax) extMax = dMax
          } else {
            const data = layer.attributes[qk]
            if (!data) continue
            for (let i = 0; i < data.length; i++) {
              if (data[i] < extMin) extMin = data[i]
              if (data[i] > extMax) extMax = data[i]
            }
          }
        }
      }

      if (extMin !== Infinity) this.setDataExtent(quantityKind, extMin, extMax)

      if (axesOverrides[quantityKind]) {
        const override = axesOverrides[quantityKind]
        this.setRange(
          quantityKind,
          override.min !== undefined ? override.min : null,
          override.max !== undefined ? override.max : null
        )
      }
    }

    for (const quantityKind of this.getQuantityKinds()) {
      if (getScaleTypeFloat(quantityKind, axesOverrides) <= 0.5) continue
      const extent = this.getDataExtent(quantityKind)
      if (extent && extent[0] <= 0) {
        throw new Error(
          `Filter axis '${quantityKind}' uses log scale but data minimum is ${extent[0]}. ` +
          `All data values must be > 0 for log scale.`
        )
      }
      const filterRange = this.getRange(quantityKind)
      if (filterRange) {
        if (filterRange.min !== null && filterRange.min <= 0) {
          throw new Error(
            `Filter axis '${quantityKind}' uses log scale but min is ${filterRange.min}. ` +
            `min must be > 0 for log scale.`
          )
        }
        if (filterRange.max !== null && filterRange.max <= 0) {
          throw new Error(
            `Filter axis '${quantityKind}' uses log scale but max is ${filterRange.max}. ` +
            `max must be > 0 for log scale.`
          )
        }
      }
    }
  }
}

// Injects a GLSL helper used by layer shaders to apply filter axis bounds.
//
// filter_in_range(vec4 range, float value):
//   range.xy = [min, max] (only used when the corresponding flag is set)
//   range.zw = [hasMin, hasMax] — 1.0 if bound is active, 0.0 if open
//   Returns false (discard) if value falls outside any active bound.
export function buildFilterGlsl() {
  return `
bool filter_in_range(vec4 range, float value) {
  if (range.z > 0.5 && value < range.x) return false;
  if (range.w > 0.5 && value > range.y) return false;
  return true;
}
`
}
