export class FilterAxisRegistry {
  constructor() {
    this._axes = new Map() // quantityKind -> { min: number|null, max: number|null }
  }

  ensureFilterAxis(quantityKind) {
    if (!this._axes.has(quantityKind)) {
      this._axes.set(quantityKind, { min: null, max: null })
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

  hasAxis(quantityKind) {
    return this._axes.has(quantityKind)
  }

  getQuantityKinds() {
    return Array.from(this._axes.keys())
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
