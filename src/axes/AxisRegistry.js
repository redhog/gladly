import * as d3 from "d3-scale"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"

// Geometry of every spatial axis position in the normalised unit cube [-1, +1]³.
//   dir:     which dimension varies along this axis ('x', 'y', or 'z')
//   fixed:   the two non-varying coordinates on the unit cube faces
//   outward: model-space unit vector pointing away from the cube face
//            (tick marks and labels are offset in this direction)
export const AXIS_GEOMETRY = {
  // X-axes: x ∈ [-1,+1] varies; y and z are fixed
  'xaxis_bottom':      { dir: 'x', fixed: { y: -1, z: +1 }, outward: [0, -1, 0] },
  'xaxis_top':         { dir: 'x', fixed: { y: +1, z: +1 }, outward: [0, +1, 0] },
  'xaxis_bottom_back': { dir: 'x', fixed: { y: -1, z: -1 }, outward: [0, -1, 0] },
  'xaxis_top_back':    { dir: 'x', fixed: { y: +1, z: -1 }, outward: [0, +1, 0] },
  // Y-axes: y ∈ [-1,+1] varies; x and z are fixed
  'yaxis_left':        { dir: 'y', fixed: { x: -1, z: +1 }, outward: [-1, 0, 0] },
  'yaxis_right':       { dir: 'y', fixed: { x: +1, z: +1 }, outward: [+1, 0, 0] },
  'yaxis_left_back':   { dir: 'y', fixed: { x: -1, z: -1 }, outward: [-1, 0, 0] },
  'yaxis_right_back':  { dir: 'y', fixed: { x: +1, z: -1 }, outward: [+1, 0, 0] },
  // Z-axes: z ∈ [-1,+1] varies; x and y are fixed
  'zaxis_bottom_left':  { dir: 'z', fixed: { x: -1, y: -1 }, outward: [0, -1, 0] },
  'zaxis_bottom_right': { dir: 'z', fixed: { x: +1, y: -1 }, outward: [0, -1, 0] },
  'zaxis_top_left':     { dir: 'z', fixed: { x: -1, y: +1 }, outward: [0, +1, 0] },
  'zaxis_top_right':    { dir: 'z', fixed: { x: +1, y: +1 }, outward: [0, +1, 0] },
}

// All 12 spatial axis names.
export const AXES = Object.keys(AXIS_GEOMETRY)

// The four original 2D axis positions (used by ZoomController for 2D pan/zoom).
export const AXES_2D = ['xaxis_bottom', 'xaxis_top', 'yaxis_left', 'yaxis_right']

// Returns the start and end model-space points [x,y,z] of an axis in the unit cube.
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

// Returns the model-space position of a point at normalised position n ∈ [0,1] along an axis.
export function axisPosAtN(axisName, n) {
  const u = n * 2 - 1   // [0,1] → [-1,+1]
  const { dir, fixed } = AXIS_GEOMETRY[axisName]
  if (dir === 'x') return [u, fixed.y, fixed.z]
  if (dir === 'y') return [fixed.x, u, fixed.z]
  return [fixed.x, fixed.y, u]
}

export class AxisRegistry {
  constructor(width, height) {
    this.scales = {}
    this.axisQuantityKinds = {}
    this.width  = width
    this.height = height
    for (const a of AXES) {
      this.scales[a]            = null
      this.axisQuantityKinds[a] = null
    }
  }

  ensureAxis(axisName, axisQuantityKind, scaleOverride) {
    if (!AXES.includes(axisName))
      throw new Error(`Unknown axis '${axisName}'`)
    if (this.axisQuantityKinds[axisName] && this.axisQuantityKinds[axisName] !== axisQuantityKind)
      throw new Error(`Axis quantity kind mismatch on '${axisName}': ${this.axisQuantityKinds[axisName]} vs ${axisQuantityKind}`)

    if (!this.scales[axisName]) {
      const qkDef    = getAxisQuantityKind(axisQuantityKind)
      const scaleType = scaleOverride ?? qkDef.scale
      const dir = AXIS_GEOMETRY[axisName].dir
      // D3 scale range: pixel length for x/y axes (used for tick-density hints in 2D).
      // Z-axes use [0, 1] (no direct pixel mapping; tick density computed from projected length).
      const range = dir === 'z' ? [0, 1]
        : dir === 'y' ? [this.height, 0]   // inverted so y=0 → top
        : [0, this.width]
      this.scales[axisName] = scaleType === 'log'
        ? d3.scaleLog().range(range)
        : d3.scaleLinear().range(range)
      this.axisQuantityKinds[axisName] = axisQuantityKind
    }
    return this.scales[axisName]
  }

  getScale(axisName) { return this.scales[axisName] }

  isLogScale(axisName) {
    const s = this.scales[axisName]
    return !!s && typeof s.base === 'function'
  }

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    const autoDomains = {}

    for (const axis of AXES) {
      const used = layers.filter(l => l.xAxis === axis || l.yAxis === axis || l.zAxis === axis)
      if (used.length === 0) continue

      let min = Infinity, max = -Infinity
      for (const layer of used) {
        const qk = layer.xAxis === axis ? layer.xAxisQuantityKind
          : layer.yAxis === axis        ? layer.yAxisQuantityKind
          : layer.zAxisQuantityKind
        if (layer.domains[qk] !== undefined) {
          const [dMin, dMax] = layer.domains[qk]
          if (dMin < min) min = dMin
          if (dMax > max) max = dMax
        } else if (qk && !layer.type?.suppressWarnings) {
          console.warn(
            `[gladly] Layer type '${layer.type?.name ?? 'unknown'}' has no domain for ` +
            `quantity kind '${qk}' on axis '${axis}'. ` +
            `Auto-domain for this axis cannot be computed from this layer.`
          )
        }
      }
      if (min !== Infinity) {
        if (!isFinite(min) || !isFinite(max))
          throw new Error(`[gladly] Axis '${axis}': auto-computed domain [${min}, ${max}] is non-finite.`)
        if (min === max)
          console.warn(`[gladly] Axis '${axis}': auto-computed domain is degenerate (all data at ${min}).`)
        autoDomains[axis] = [min, max]
      }
    }

    for (const axis of AXES) {
      const scale = this.getScale(axis)
      if (!scale) continue
      const override = axesOverrides[axis]
      const domain   = override ? [override.min, override.max] : autoDomains[axis]
      if (domain) {
        const [lo, hi] = domain
        if (lo == null || hi == null || !isFinite(lo) || !isFinite(hi))
          throw new Error(`[gladly] Axis '${axis}': domain [${lo}, ${hi}] contains null or non-finite values.`)
        if (lo === hi)
          console.warn(`[gladly] Axis '${axis}': domain [${lo}] is degenerate (min equals max).`)
        scale.domain(domain)
      }
    }

    for (const axis of AXES) {
      if (!this.isLogScale(axis)) continue
      const [dMin, dMax] = this.getScale(axis).domain()
      if ((isFinite(dMin) && dMin <= 0) || (isFinite(dMax) && dMax <= 0))
        throw new Error(`Axis '${axis}' uses log scale but has non-positive domain [${dMin}, ${dMax}].`)
    }
  }

  setScaleType(axisName, scaleType) {
    const scale = this.scales[axisName]
    if (!scale) return
    const currentIsLog = typeof scale.base === 'function'
    const wantLog = scaleType === 'log'
    if (currentIsLog === wantLog) return
    const currentDomain = scale.domain()
    const dir = AXIS_GEOMETRY[axisName].dir
    const range = dir === 'z' ? [0, 1]
      : dir === 'y' ? [this.height, 0]
      : [0, this.width]
    const newScale = wantLog
      ? d3.scaleLog().range(range)
      : d3.scaleLinear().range(range)
    newScale.domain(currentDomain)
    this.scales[axisName] = newScale
  }
}
