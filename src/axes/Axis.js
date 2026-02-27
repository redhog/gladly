import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis"
import { AXES } from "./AxisRegistry.js"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"

const AXIS_CONSTRUCTORS = {
  xaxis_bottom: axisBottom,
  xaxis_top:    axisTop,
  yaxis_left:   axisLeft,
  yaxis_right:  axisRight,
}

function formatTick(v) {
  if (v === 0) return "0"
  const abs = Math.abs(v)
  if (abs >= 10000 || abs < 0.01) {
    return v.toExponential(2).replace(/\.?0+(e)/, '$1')
  }
  const s = v.toPrecision(4)
  if (s.includes('.') && !s.includes('e')) {
    return s.replace(/\.?0+$/, '')
  }
  return s
}

// Returns tick values for a log scale using the 1-2-5 sequence (1×, 2×, 5× per decade),
// which gives evenly-spaced marks in log space across any domain size.
// Falls back to powers-of-10 (subsampled if needed) when the domain is too wide for
// 1-2-5 ticks to fit within pixelCount. Returns null for very narrow domains where
// no "nice" values land inside, so the caller can fall back to D3's default logic.
function logTickValues(scale, pixelCount) {
  const [dMin, dMax] = scale.domain()
  if (dMin <= 0 || dMax <= 0) return null

  const logMin = Math.log10(dMin)
  const logMax = Math.log10(dMax)
  const startExp = Math.floor(logMin)
  const endExp = Math.ceil(logMax)

  const candidate = []
  for (let e = startExp; e < endExp; e++) {
    const base = Math.pow(10, e)
    for (const mult of [1, 2, 5]) {
      const v = base * mult
      if (v >= dMin * (1 - 1e-10) && v <= dMax * (1 + 1e-10)) candidate.push(v)
    }
  }
  const upperPow = Math.pow(10, endExp)
  if (upperPow >= dMin * (1 - 1e-10) && upperPow <= dMax * (1 + 1e-10)) candidate.push(upperPow)

  if (candidate.length >= 2 && candidate.length <= pixelCount) {
    return candidate
  }

  const firstExp = Math.ceil(logMin)
  const lastExp = Math.floor(logMax)
  if (firstExp > lastExp) {
    return candidate.length >= 2 ? candidate : null
  }
  const numPowers = lastExp - firstExp + 1
  const step = numPowers > pixelCount ? Math.ceil(numPowers / pixelCount) : 1
  const powers = []
  for (let e = firstExp; e <= lastExp; e += step) {
    powers.push(Math.pow(10, e))
  }
  return powers.length >= 2 ? powers : null
}

/**
 * An Axis represents a single data axis on a plot. Axis instances are stable across
 * plot.update() calls and can be linked together with linkAxes().
 *
 * Public interface (duck-typing compatible):
 *   - axis.quantityKind   — string | null
 *   - axis.isSpatial      — boolean; true for xaxis_bottom/xaxis_top/yaxis_left/yaxis_right
 *   - axis.getDomain()    — [min, max] | null
 *   - axis.setDomain(domain) — update domain, schedule render, notify subscribers
 *   - axis.subscribe(callback)   — callback([min, max]) called on domain changes
 *   - axis.unsubscribe(callback) — remove a previously added callback
 */
export class Axis {
  constructor(plot, name) {
    this._plot = plot
    this._name = name
    this._listeners = new Set()
    this._propagating = false
  }

  /** The quantity kind for this axis, or null if the plot hasn't been initialized yet. */
  get quantityKind() { return this._plot.getAxisQuantityKind(this._name) }

  /** True if this is a spatial (D3-rendered) axis; false for color/filter axes. */
  get isSpatial() { return AXES.includes(this._name) }

  /** Returns [min, max], or null if the axis has no domain yet. */
  getDomain() { return this._plot.getAxisDomain(this._name) }

  /**
   * Sets the axis domain, schedules a render on the owning plot, and notifies all
   * subscribers (e.g. linked axes). A _propagating guard prevents infinite loops
   * when axes are linked bidirectionally.
   */
  setDomain(domain) {
    if (this._propagating) return
    this._propagating = true
    try {
      this._plot.setAxisDomain(this._name, domain)
      this._plot.scheduleRender()
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  /** Add a subscriber. callback([min, max]) is called after every setDomain(). */
  subscribe(callback) { this._listeners.add(callback) }

  /** Remove a previously added subscriber. */
  unsubscribe(callback) { this._listeners.delete(callback) }

  // ─── Spatial axis rendering ───────────────────────────────────────────────

  _tickCount(rotate = false) {
    const { plotWidth, plotHeight } = this._plot
    if (this._name.includes("y")) {
      return Math.max(2, Math.floor(plotHeight / 27))
    }
    const pixelsPerTick = rotate ? 28 : 40
    return Math.max(2, Math.floor(plotWidth / pixelsPerTick))
  }

  _makeD3Axis(scale, { rotate = false } = {}) {
    const isLog = typeof scale.base === 'function'
    const count = this._tickCount(rotate)
    const gen = AXIS_CONSTRUCTORS[this._name](scale).tickFormat(formatTick)
    if (isLog) {
      const tv = logTickValues(scale, count)
      if (tv !== null) {
        gen.tickValues(tv)
      } else {
        gen.ticks(count)
      }
    } else if (count <= 2) {
      gen.tickValues(scale.domain())
    } else {
      gen.ticks(count)
    }
    return gen
  }

  _renderLabel(axisGroup, availableMargin) {
    const { axisRegistry, currentConfig, plotWidth, plotHeight } = this._plot
    const axisQuantityKind = axisRegistry.axisQuantityKinds[this._name]
    if (!axisQuantityKind) return

    const unitLabel = currentConfig?.axes?.[axisQuantityKind]?.label
      ?? getAxisQuantityKind(axisQuantityKind).label
    const isVertical = this._name.includes("y")
    const centerPos = isVertical ? -plotHeight / 2 : plotWidth / 2

    axisGroup.select(".axis-label").remove()

    const text = axisGroup.append("text")
      .attr("class", "axis-label")
      .attr("fill", "#000")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "bold")

    const lines = unitLabel.split('\n')
    if (lines.length > 1) {
      lines.forEach((line, i) => {
        text.append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? "0em" : "1.2em")
          .text(line)
      })
    } else {
      text.text(unitLabel)
    }

    if (isVertical) text.attr("transform", "rotate(-90)")
    text.attr("x", centerPos).attr("y", 0)

    const bbox = text.node().getBBox()
    const tickSpace = 25
    let yOffset

    if (this._name === "xaxis_bottom") {
      yOffset = (tickSpace + (availableMargin - tickSpace) / 2) - (bbox.y + bbox.height / 2)
    } else if (this._name === "xaxis_top") {
      yOffset = -(tickSpace + (availableMargin - tickSpace) / 2) - (bbox.y + bbox.height / 2)
    } else if (this._name === "yaxis_left") {
      yOffset = -(tickSpace + (availableMargin - tickSpace) / 2) - (bbox.y + bbox.height / 2)
    } else if (this._name === "yaxis_right") {
      yOffset = (tickSpace + (availableMargin - tickSpace) / 2) - (bbox.y + bbox.height / 2)
    }

    text.attr("y", yOffset)
  }

  /**
   * Renders this axis into the plot's SVG. No-op for non-spatial axes (color/filter).
   * Called by Plot.render() after each WebGL frame.
   */
  render() {
    if (!this.isSpatial) return
    const { svg, margin, plotWidth, plotHeight, axisRegistry, currentConfig } = this._plot
    const scale = axisRegistry.getScale(this._name)
    if (!scale) return

    const axisConfig = currentConfig?.axes?.[this._name] ?? {}
    const rotate = axisConfig.rotate ?? false

    let transform, availableMargin
    if (this._name === "xaxis_bottom") {
      transform = `translate(${margin.left},${margin.top + plotHeight})`
      availableMargin = margin.bottom
    } else if (this._name === "xaxis_top") {
      transform = `translate(${margin.left},${margin.top})`
      availableMargin = margin.top
    } else if (this._name === "yaxis_left") {
      transform = `translate(${margin.left},${margin.top})`
      availableMargin = margin.left
    } else if (this._name === "yaxis_right") {
      transform = `translate(${margin.left + plotWidth},${margin.top})`
      availableMargin = margin.right
    }

    const g = svg.select(`.${this._name}`)
      .attr("transform", transform)
      .call(this._makeD3Axis(scale, { rotate }))

    g.select(".domain").attr("stroke", "#000").attr("stroke-width", 2)
    g.selectAll(".tick line").attr("stroke", "#000")
    g.selectAll(".tick text").attr("fill", "#000").style("font-size", "12px")

    if (rotate && this._name === "xaxis_bottom") {
      g.selectAll(".tick text")
        .style("text-anchor", "end")
        .attr("dx", "-0.8em")
        .attr("dy", "0.15em")
        .attr("transform", "rotate(-45)")
    } else if (rotate && this._name === "xaxis_top") {
      g.selectAll(".tick text")
        .style("text-anchor", "start")
        .attr("dx", "0.8em")
        .attr("dy", "-0.35em")
        .attr("transform", "rotate(45)")
    }

    this._renderLabel(g, availableMargin)
  }
}
