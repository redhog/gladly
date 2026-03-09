import * as d3 from "d3-scale"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"

export const AXES = ["xaxis_bottom","xaxis_top","yaxis_left","yaxis_right"]

export class AxisRegistry {
  constructor(width, height) {
    this.scales = {}
    this.axisQuantityKinds = {}
    this.width = width
    this.height = height
    AXES.forEach(a => {
      this.scales[a] = null
      this.axisQuantityKinds[a] = null
    })
  }

  ensureAxis(axisName, axisQuantityKind, scaleOverride) {
    if (!AXES.includes(axisName)) throw new Error(`Unknown axis ${axisName}`)
    if (this.axisQuantityKinds[axisName] && this.axisQuantityKinds[axisName] !== axisQuantityKind)
      throw new Error(`Axis quantity kind mismatch on axis ${axisName}: ${this.axisQuantityKinds[axisName]} vs ${axisQuantityKind}`)

    if (!this.scales[axisName]) {
      const quantityKindDef = getAxisQuantityKind(axisQuantityKind)
      const scaleType = scaleOverride ?? quantityKindDef.scale
      this.scales[axisName] = scaleType === "log"
        ? d3.scaleLog().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
        : d3.scaleLinear().range(axisName.includes("y") ? [this.height,0] : [0,this.width])
      this.axisQuantityKinds[axisName] = axisQuantityKind
    }
    return this.scales[axisName]
  }

  getScale(axisName) { return this.scales[axisName] }

  isLogScale(axisName) {
    const scale = this.scales[axisName]
    return !!scale && typeof scale.base === 'function'
  }

  applyAutoDomainsFromLayers(layers, axesOverrides) {
    const autoDomains = {}

    for (const axis of AXES) {
      const layersUsingAxis = layers.filter(l => l.xAxis === axis || l.yAxis === axis)
      if (layersUsingAxis.length === 0) continue

      let min = Infinity, max = -Infinity
      for (const layer of layersUsingAxis) {
        const isXAxis = layer.xAxis === axis
        const qk = isXAxis ? layer.xAxisQuantityKind : layer.yAxisQuantityKind
        if (layer.domains[qk] !== undefined) {
          const [dMin, dMax] = layer.domains[qk]
          if (dMin < min) min = dMin
          if (dMax > max) max = dMax
        } else if (qk) {
          console.warn(
            `[gladly] Layer type '${layer.type?.name ?? 'unknown'}' has no domain for ` +
            `quantity kind '${qk}' on axis '${axis}'. ` +
            `Auto-domain for this axis cannot be computed from this layer.`
          )
        }
      }
      if (min !== Infinity) {
        if (!isFinite(min) || !isFinite(max)) {
          throw new Error(
            `[gladly] Axis '${axis}': auto-computed domain [${min}, ${max}] contains non-finite values. ` +
            `Check that data columns contain no NaN or Infinity values.`
          )
        }
        if (min === max) {
          console.warn(
            `[gladly] Axis '${axis}': auto-computed domain is degenerate — all data on this axis has the same value (${min}). ` +
            `Data will collapse to a single line. Set an explicit min/max in the axes config to widen the range.`
          )
        }
        autoDomains[axis] = [min, max]
      }
    }

    for (const axis of AXES) {
      const scale = this.getScale(axis)
      if (!scale) continue
      const override = axesOverrides[axis]
      const domain = override ? [override.min, override.max] : autoDomains[axis]
      if (domain) {
        const [lo, hi] = domain
        if (lo == null || hi == null || !isFinite(lo) || !isFinite(hi)) {
          throw new Error(
            `[gladly] Axis '${axis}': domain [${lo}, ${hi}] contains null or non-finite values. ` +
            `Check the axes config min/max or your data.`
          )
        }
        if (lo === hi) {
          console.warn(
            `[gladly] Axis '${axis}': domain [${lo}] is degenerate (min equals max). ` +
            `Data will collapse to a single line on this axis.`
          )
        }
        scale.domain(domain)
      }
    }

    for (const axis of AXES) {
      if (!this.isLogScale(axis)) continue
      const [dMin, dMax] = this.getScale(axis).domain()
      if ((isFinite(dMin) && dMin <= 0) || (isFinite(dMax) && dMax <= 0)) {
        throw new Error(
          `Axis '${axis}' uses log scale but has non-positive domain [${dMin}, ${dMax}]. ` +
          `All data values and min/max must be > 0 for log scale.`
        )
      }
    }
  }

  setScaleType(axisName, scaleType) {
    const scale = this.scales[axisName]
    if (!scale) return
    const currentIsLog = typeof scale.base === 'function'
    const wantLog = scaleType === "log"
    if (currentIsLog === wantLog) return
    const currentDomain = scale.domain()
    const newScale = wantLog
      ? d3.scaleLog().range(axisName.includes("y") ? [this.height, 0] : [0, this.width])
      : d3.scaleLinear().range(axisName.includes("y") ? [this.height, 0] : [0, this.width])
    newScale.domain(currentDomain)
    this.scales[axisName] = newScale
  }
}
