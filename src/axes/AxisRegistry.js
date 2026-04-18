import * as d3 from "d3-scale"
import { getAxisQuantityKind, getScaleTypeFloat } from "./AxisQuantityKindRegistry.js"
import { getColorscaleIndex } from "../colorscales/ColorscaleRegistry.js"

export const AXIS_GEOMETRY = {
  'xaxis_bottom':      { dir: 'x', fixed: { y: -1, z: +1 }, outward: [0, -1, 0] },
  'xaxis_top':         { dir: 'x', fixed: { y: +1, z: +1 }, outward: [0, +1, 0] },
  'xaxis_bottom_back': { dir: 'x', fixed: { y: -1, z: -1 }, outward: [0, -1, 0] },
  'xaxis_top_back':    { dir: 'x', fixed: { y: +1, z: -1 }, outward: [0, +1, 0] },
  'yaxis_left':        { dir: 'y', fixed: { x: -1, z: +1 }, outward: [-1, 0, 0] },
  'yaxis_right':       { dir: 'y', fixed: { x: +1, z: +1 }, outward: [+1, 0, 0] },
  'yaxis_left_back':   { dir: 'y', fixed: { x: -1, z: -1 }, outward: [-1, 0, 0] },
  'yaxis_right_back':  { dir: 'y', fixed: { x: +1, z: -1 }, outward: [+1, 0, 0] },
  'zaxis_bottom_left':  { dir: 'z', fixed: { x: -1, y: -1 }, outward: [0, -1, 0] },
  'zaxis_bottom_right': { dir: 'z', fixed: { x: +1, y: -1 }, outward: [0, -1, 0] },
  'zaxis_top_left':     { dir: 'z', fixed: { x: -1, y: +1 }, outward: [0, +1, 0] },
  'zaxis_top_right':    { dir: 'z', fixed: { x: +1, y: +1 }, outward: [0, +1, 0] },
}

export const AXES = Object.keys(AXIS_GEOMETRY)
export const AXES_2D = ['xaxis_bottom', 'xaxis_top', 'yaxis_left', 'yaxis_right']

export function axisEndpoints(axisName) {
  const { dir, fixed } = AXIS_GEOMETRY[axisName]
  const start = [0, 0, 0], end = [0, 0, 0]
  if (dir === 'x') {
    start[0] = -1; end[0] = +1
    start[1] = end[1] = fixed.y
    start[2] = end[2] = fixed.z
  } else if (dir === 'y') {
    start[0] = end[0] = fixed.x
    start[1] = -1; end[1] = +1
    start[2] = end[2] = fixed.z
  } else {
    start[0] = end[0] = fixed.x
    start[1] = end[1] = fixed.y
    start[2] = -1; end[2] = +1
  }
  return { start, end }
}

export function axisPosAtN(axisName, n) {
  const u = n * 2 - 1
  const { dir, fixed } = AXIS_GEOMETRY[axisName]
  if (dir === 'x') return [u, fixed.y, fixed.z]
  if (dir === 'y') return [fixed.x, u, fixed.z]
  return [fixed.x, fixed.y, u]
}

// Single unified axis registry keyed by quantity kind.
//
// Each QK entry holds one shared domain plus role-specific settings for the
// spatial (D3 scale per slot), color, and filter roles.  All roles read from
// the same domain so spatial zoom, colorscale mapping, and data filtering
// always stay in sync.
//
// clampMin / clampMax (unified for both color and filter):
//   true  → open/inclusive on that side
//            color: values outside domain are clamped to the endpoint colour
//            filter: no filtering on that side (data passes through)
//   false → exclusive on that side
//            color: values outside domain are discarded
//            filter: data outside domain[0..1] on that side is discarded
export class AxisRegistry {
  constructor(width = 1, height = 1) {
    this.width  = width
    this.height = height
    this._entries  = new Map()  // qk → entry
    this._slotToQk = new Map()  // slotId → qk
  }

  _ensureEntry(qk) {
    if (!this._entries.has(qk)) {
      this._entries.set(qk, {
        domain:     null,      // [min, max] or null
        slots:      new Map(), // slotId → D3Scale
        hasColor:   false,
        colorscale: null,
        clampMin:   true,
        clampMax:   true,
        alphaBlend: 0.0,
        hasFilter:  false,
        dataExtent: null,      // [min, max] raw data extent for filterbar display
      })
    }
    return this._entries.get(qk)
  }

  // ── Registration ──────────────────────────────────────────────────────────

  ensureSpatialSlot(slotId, qk, scaleOverride = null) {
    if (!AXES.includes(slotId))
      throw new Error(`Unknown axis '${slotId}'`)
    const existingQk = this._slotToQk.get(slotId)
    if (existingQk && existingQk !== qk)
      throw new Error(`Axis quantity kind mismatch on '${slotId}': ${existingQk} vs ${qk}`)

    const entry = this._ensureEntry(qk)
    if (!entry.slots.has(slotId)) {
      const qkDef     = getAxisQuantityKind(qk)
      const scaleType = scaleOverride ?? qkDef.scale
      const dir       = AXIS_GEOMETRY[slotId].dir
      const range     = dir === 'z' ? [0, 1]
        : dir === 'y' ? [this.height, 0]
        : [0, this.width]
      const scale = scaleType === 'log'
        ? d3.scaleLog().range(range)
        : d3.scaleLinear().range(range)
      if (entry.domain) scale.domain(entry.domain)
      entry.slots.set(slotId, scale)
      this._slotToQk.set(slotId, qk)
    }
  }

  ensureColorAxis(qk, colorscaleOverride = null) {
    const entry = this._ensureEntry(qk)
    entry.hasColor = true
    if (colorscaleOverride !== null) entry.colorscale = colorscaleOverride
  }

  ensureFilterAxis(qk) {
    this._ensureEntry(qk).hasFilter = true
  }

  // ── Domain ────────────────────────────────────────────────────────────────

  // Set the shared domain for a QK. Updates all spatial D3 scales for this QK.
  setDomain(qk, domain) {
    const entry = this._entries.get(qk)
    if (!entry) return
    entry.domain = domain
    for (const scale of entry.slots.values()) scale.domain(domain)
  }

  getDomain(qk) {
    return this._entries.get(qk)?.domain ?? null
  }

  // ── Spatial ───────────────────────────────────────────────────────────────

  getScale(slotId) {
    const qk = this._slotToQk.get(slotId)
    return qk ? (this._entries.get(qk)?.slots.get(slotId) ?? null) : null
  }

  isLogScale(slotId) {
    const scale = this.getScale(slotId)
    return !!scale && typeof scale.base === 'function'
  }

  setScaleType(slotId, scaleType) {
    const qk = this._slotToQk.get(slotId)
    if (!qk) return
    const entry = this._entries.get(qk)
    const scale = entry?.slots.get(slotId)
    if (!scale) return
    const wantLog = scaleType === 'log'
    if ((typeof scale.base === 'function') === wantLog) return
    const dir   = AXIS_GEOMETRY[slotId].dir
    const range = dir === 'z' ? [0, 1]
      : dir === 'y' ? [this.height, 0]
      : [0, this.width]
    const newScale = wantLog
      ? d3.scaleLog().range(range)
      : d3.scaleLinear().range(range)
    newScale.domain(scale.domain())
    entry.slots.set(slotId, newScale)
  }

  getQkForSlot(slotId) {
    return this._slotToQk.get(slotId) ?? null
  }

  // Computed getter returning { slotId: qk } for code that reads axisQuantityKinds[slotId].
  get axisQuantityKinds() {
    const result = {}
    for (const [slotId, qk] of this._slotToQk) result[slotId] = qk
    return result
  }

  hasSpatialSlot(slotId) { return this._slotToQk.has(slotId) }

  // ── Querying ──────────────────────────────────────────────────────────────

  hasAxis(qk)       { return this._entries.has(qk) }
  hasColorAxis(qk)  { return this._entries.get(qk)?.hasColor  ?? false }
  hasFilterAxis(qk) { return this._entries.get(qk)?.hasFilter ?? false }

  getQuantityKinds()       { return Array.from(this._entries.keys()) }
  getColorQuantityKinds()  { return Array.from(this._entries.keys()).filter(qk => this._entries.get(qk).hasColor) }
  getFilterQuantityKinds() { return Array.from(this._entries.keys()).filter(qk => this._entries.get(qk).hasFilter) }

  // ── Color ─────────────────────────────────────────────────────────────────

  getColorscale(qk) {
    const entry = this._entries.get(qk)
    if (!entry) return null
    if (entry.colorscale) return entry.colorscale
    return getAxisQuantityKind(qk).colorscale ?? null
  }

  getColorscaleIndex(qk) {
    const cs = this.getColorscale(qk)
    return cs ? getColorscaleIndex(cs) : 0
  }

  getAlphaBlend(qk) { return this._entries.get(qk)?.alphaBlend ?? 0.0 }

  getClampMin(qk) { return this._entries.get(qk)?.clampMin ?? true }
  getClampMax(qk) { return this._entries.get(qk)?.clampMax ?? true }

  setClamp(qk, clampMin, clampMax) {
    const entry = this._entries.get(qk)
    if (!entry) throw new Error(`Axis '${qk}' not found in registry`)
    entry.clampMin = clampMin
    entry.clampMax = clampMax
  }

  // [domain[0], domain[1], !clampMin, !clampMax] as a vec4 for the color filter shader.
  getColorFilterRangeUniform(qk) {
    const domain = this.getDomain(qk) ?? [0, 1]
    const entry  = this._entries.get(qk)
    return [
      domain[0], domain[1],
      entry && !entry.clampMin ? 1.0 : 0.0,
      entry && !entry.clampMax ? 1.0 : 0.0,
    ]
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  // [domain[0], domain[1], minActive, maxActive] as a vec4 for the filter shader.
  // minActive = 1 when clampMin=false (bound is enforced); 0 when clampMin=true (open).
  getFilterRangeUniform(qk) {
    const entry = this._entries.get(qk)
    if (!entry?.hasFilter || !entry.domain) return [0.0, 0.0, 0.0, 0.0]
    return [
      entry.domain[0], entry.domain[1],
      entry.clampMin ? 0.0 : 1.0,
      entry.clampMax ? 0.0 : 1.0,
    ]
  }

  // Returns { min: number|null, max: number|null } — null means that bound is open (inactive).
  getFilterBounds(qk) {
    const entry = this._entries.get(qk)
    if (!entry?.hasFilter) return null
    const d = entry.domain
    return {
      min: (!entry.clampMin && d) ? d[0] : null,
      max: (!entry.clampMax && d) ? d[1] : null,
    }
  }

  // null = deactivate that bound (open / clampMin=true);
  // number = activate that bound (clampMin=false) and update domain end to that value.
  setFilterBounds(qk, minOrNull, maxOrNull) {
    const entry = this._entries.get(qk)
    if (!entry?.hasFilter) return
    const d = entry.domain ? [...entry.domain]
      : (entry.dataExtent ? [...entry.dataExtent] : [0, 1])
    if (minOrNull !== null) { entry.clampMin = false; d[0] = minOrNull }
    else                      entry.clampMin = true
    if (maxOrNull !== null) { entry.clampMax = false; d[1] = maxOrNull }
    else                      entry.clampMax = true
    this.setDomain(qk, d)
  }

  getDataExtent(qk) { return this._entries.get(qk)?.dataExtent ?? null }

  setDataExtent(qk, min, max) {
    const entry = this._entries.get(qk)
    if (entry) entry.dataExtent = [min, max]
  }

  // ── Auto-domain from layers ───────────────────────────────────────────────

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    for (const [qk, entry] of this._entries) {
      // Collect domain extent from every layer that uses this QK in any role.
      let min = Infinity, max = -Infinity

      for (const layer of layers) {
        const usedSpatially =
          (layer.xAxisQuantityKind === qk && layer.xAxis) ||
          (layer.yAxisQuantityKind === qk && layer.yAxis) ||
          (layer.zAxisQuantityKind === qk && layer.zAxis)
        const usedAsColor  = Object.values(layer.colorAxes  ?? {}).includes(qk)
        const usedAsFilter = Object.values(layer.filterAxes ?? {}).includes(qk)

        if (usedSpatially || usedAsColor || usedAsFilter) {
          if (layer.domains[qk] !== undefined) {
            const [dMin, dMax] = layer.domains[qk]
            if (dMin < min) min = dMin
            if (dMax > max) max = dMax
          } else if (usedSpatially && !layer.type?.suppressWarnings) {
            console.warn(
              `[gladly] Layer '${layer.type?.name ?? 'unknown'}' has no domain for ` +
              `quantity kind '${qk}'. Auto-domain cannot be computed from this layer.`
            )
          }
        }
      }

      // Resolve override: slot-level overrides take priority over QK-level.
      let overrideMin, overrideMax
      for (const [slotId, slotQk] of this._slotToQk) {
        if (slotQk !== qk) continue
        const so = axesOverrides[slotId]
        if (so?.min != null && overrideMin === undefined) overrideMin = so.min
        if (so?.max != null && overrideMax === undefined) overrideMax = so.max
      }
      const qkOv = axesOverrides[qk]
      if (overrideMin === undefined && qkOv?.min != null) overrideMin = qkOv.min
      if (overrideMax === undefined && qkOv?.max != null) overrideMax = qkOv.max

      const finalMin = overrideMin ?? (min !== Infinity  ? min : undefined)
      const finalMax = overrideMax ?? (max !== -Infinity ? max : undefined)

      if (finalMin !== undefined && finalMax !== undefined) {
        if (!isFinite(finalMin) || !isFinite(finalMax))
          throw new Error(`[gladly] Axis '${qk}': computed domain [${finalMin}, ${finalMax}] is non-finite.`)
        if (finalMin === finalMax)
          console.warn(`[gladly] Axis '${qk}': domain is degenerate (all data at ${finalMin}).`)
        this.setDomain(qk, [finalMin, finalMax])
      }

      // Color-specific overrides.
      if (entry.hasColor && qkOv) {
        if (qkOv.colorscale && qkOv.colorscale !== "none") entry.colorscale = qkOv.colorscale
        if (qkOv.alpha_blend !== undefined) entry.alphaBlend = qkOv.alpha_blend
      }

      // Unified clamp overrides (apply to both color and filter).
      if (qkOv?.clamp_min !== undefined) entry.clampMin = !!qkOv.clamp_min
      if (qkOv?.clamp_max !== undefined) entry.clampMax = !!qkOv.clamp_max

      // Store data extent for filter axis (Filterbar display).
      if (entry.hasFilter && min !== Infinity) entry.dataExtent = [min, max]
    }

    // Log scale validation.
    for (const [qk, entry] of this._entries) {
      for (const [slotId, scale] of entry.slots) {
        if (typeof scale.base !== 'function') continue
        const [lo, hi] = scale.domain()
        if ((isFinite(lo) && lo <= 0) || (isFinite(hi) && hi <= 0))
          throw new Error(`Axis '${slotId}' uses log scale but has non-positive domain [${lo}, ${hi}].`)
      }
      if ((entry.hasColor || entry.hasFilter) && entry.domain) {
        if (getScaleTypeFloat(qk, axesOverrides) > 0.5) {
          if (entry.domain[0] <= 0 || entry.domain[1] <= 0)
            throw new Error(`Axis '${qk}' uses log scale but has non-positive domain [${entry.domain}].`)
        }
      }
    }
  }
}

// GLSL helper injected into layer shaders for filter axis bounds checking.
export function buildFilterGlsl() {
  return `
bool filter_in_range(vec4 range, float value) {
  if (range.z > 0.5 && value < range.x) return false;
  if (range.w > 0.5 && value > range.y) return false;
  return true;
}
`
}

// GLSL helper injected into layer shaders for color axis out-of-range checking.
export function buildColorFilterGlsl() {
  return `
bool color_filter_in_range(vec4 range, float value) {
  if (value != value) return true;
  if (range.z > 0.5 && value < range.x) return false;
  if (range.w > 0.5 && value > range.y) return false;
  return true;
}
`
}
