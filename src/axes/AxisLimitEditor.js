import { formatTick, TICK_LABEL_FRAC } from "./Axis.js"

const BOX_TITLE = "Click to type a value for this end"

/**
 * Check a typed axis end value.
 *
 * @param {string}  text    - what was typed; e-notation is accepted ("1e-4")
 * @param {number}  current - the end's current value
 * @param {number}  other   - the value at the axis's other end
 * @param {boolean} isLog   - whether the axis has a log scale
 * @returns {{ value: number } | { error: string }} the parsed value, or why it was refused.
 *   A value has to stay on the same side of the other end as the current one, so a
 *   reversed axis stays reversed.
 */
export function parseAxisLimit(text, current, other, isLog) {
  const s = String(text).trim()
  const value = Number(s)
  if (s === "" || !Number.isFinite(value)) return { error: "Not a number" }
  if (isLog && value <= 0) return { error: "Must be above 0 on a log axis" }
  if (value === other) return { error: `Must differ from the other end (${formatTick(other)})` }
  if (current !== other && (value > other) !== (current > other)) {
    return {
      error: current > other
        ? `Must be above the other end (${formatTick(other)})`
        : `Must be below the other end (${formatTick(other)})`,
    }
  }
  return { value }
}

// Container-pixel centers of an axis's two end labels: the end of the axis, pushed out
// onto the tick-label row the way Axis.render() places tick labels in 2D.
function endPositions(plot, axisId) {
  const { margin, plotWidth, plotHeight } = plot
  const left = margin.left, right = margin.left + plotWidth
  const top = margin.top, bottom = margin.top + plotHeight
  const off = (m) => TICK_LABEL_FRAC * Math.max(4, m)
  switch (axisId) {
    case "xaxis_bottom": { const y = bottom + off(margin.bottom); return { min: [left, y], max: [right, y] } }
    case "xaxis_top":    { const y = top - off(margin.top);       return { min: [left, y], max: [right, y] } }
    case "yaxis_left":   { const x = left - off(margin.left);     return { min: [x, bottom], max: [x, top] } }
    case "yaxis_right":  { const x = right + off(margin.right);   return { min: [x, bottom], max: [x, top] } }
  }
  return null
}

/**
 * Click-to-type limits on the two ends of each 2D spatial axis of a plot.
 *
 * Pointing at an axis's label band shows two small boxes at the ends of that axis
 * holding its end values. Clicking a box turns it into a text field. Enter sets the
 * value, Tab sets it and moves to the other end, Escape cancels, and leaving the field
 * sets a valid value and drops an invalid one. A value is set through
 * `Axis.setDomain()`, the path zoom and pan take, so linked axes follow; the plot then
 * fires an `'axislimit'` event.
 *
 * The bottom or left box is the domain's first value (the config's `min`), the top or
 * right box its second (`max`). 3D plots get no boxes.
 */
export class AxisLimitEditor {
  constructor(plot) {
    this._plot = plot
    this._boxes = new Map()   // axisId → { min: HTMLElement, max: HTMLElement }
    this._shownAxis = null
    this._editing = null      // { axisId, end, input, initial }
    this._onMouseMove = (e) => this._handleMouseMove(e)
    this._onMouseLeave = () => { if (!this._editing) this._hide() }
    plot.container.addEventListener("mousemove", this._onMouseMove)
    plot.container.addEventListener("mouseleave", this._onMouseLeave)
  }

  destroy() {
    this._plot.container.removeEventListener("mousemove", this._onMouseMove)
    this._plot.container.removeEventListener("mouseleave", this._onMouseLeave)
    this._editing = null
    for (const { min, max } of this._boxes.values()) { min.remove(); max.remove() }
    this._boxes.clear()
  }

  _isDrawn(axisId) {
    const plot = this._plot
    return !!plot.axisRegistry?.getScale(axisId) && plot.currentConfig?.axes?.[axisId]?.visible !== false
  }

  _isOwnBox(el) {
    for (const { min, max } of this._boxes.values()) {
      if (min.contains(el) || max.contains(el)) return true
    }
    return false
  }

  _handleMouseMove(e) {
    if (this._editing) return
    if (this._isOwnBox(e.target)) return
    const plot = this._plot
    // Only the plot's own canvas counts: a float (color bar, filter bar) sitting in this
    // container is a plot of its own with its own editor.
    if (e.target !== plot._canvas || plot._is3D || !plot.axisRegistry) return this._hide()
    const rect = plot.container.getBoundingClientRect()
    const region = plot._zoomController?._getRegion2D(e.clientX - rect.left, e.clientY - rect.top)
    const axisId = region?.type === "axis" ? region.axes[0] : null
    if (axisId && this._isDrawn(axisId)) this._show(axisId)
    else this._hide()
  }

  _makeBox(axisId, end) {
    const box = document.createElement("div")
    box.setAttribute("data-gladly-control", "axis-limit")
    box.setAttribute("data-axis", axisId)
    box.setAttribute("data-end", end)
    box.title = BOX_TITLE
    Object.assign(box.style, {
      position:     "absolute",
      zIndex:       "4",
      display:      "none",
      boxSizing:    "border-box",
      padding:      "0 3px",
      font:         "11px sans-serif",
      lineHeight:   "16px",
      color:        "#000",
      background:   "#fff",
      border:       "1px solid #888",
      borderRadius: "2px",
      whiteSpace:   "nowrap",
      cursor:       "text",
      userSelect:   "none",
    })
    box.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this._editing?.axisId === axisId && this._editing.end === end) return
      // Clicking the other box while typing sets the typed value first, as Tab does.
      if (this._editing && !this._commit()) return
      this._startEdit(axisId, end)
    })
    // A press on a box neither reaches anything underneath nor takes the focus away from
    // an open field, which would close it before the click arrives.
    box.addEventListener("mousedown", (e) => {
      e.stopPropagation()
      if (e.target.tagName !== "INPUT") e.preventDefault()
    })
    this._plot.container.appendChild(box)
    return box
  }

  _boxesFor(axisId) {
    if (!this._boxes.has(axisId)) {
      this._boxes.set(axisId, { min: this._makeBox(axisId, "min"), max: this._makeBox(axisId, "max") })
    }
    return this._boxes.get(axisId)
  }

  // Center a box on its end, kept inside the container.
  _place(axisId, end) {
    const pos = endPositions(this._plot, axisId)?.[end]
    if (!pos) return
    const box = this._boxesFor(axisId)[end]
    const W = this._plot.container.clientWidth, H = this._plot.container.clientHeight
    const bw = box.offsetWidth, bh = box.offsetHeight
    box.style.left = Math.max(0, Math.min(W - bw, pos[0] - bw / 2)) + "px"
    box.style.top  = Math.max(0, Math.min(H - bh, pos[1] - bh / 2)) + "px"
  }

  _show(axisId) {
    if (this._shownAxis && this._shownAxis !== axisId) this._hide()
    const domain = this._plot.getAxisDomain(axisId)
    if (!domain) return
    const boxes = this._boxesFor(axisId)
    for (const [end, value] of [["min", domain[0]], ["max", domain[1]]]) {
      boxes[end].textContent = formatTick(value)
      boxes[end].style.display = "block"
      this._place(axisId, end)
    }
    this._shownAxis = axisId
  }

  _hide() {
    if (!this._shownAxis) return
    const boxes = this._boxes.get(this._shownAxis)
    if (boxes) { boxes.min.style.display = "none"; boxes.max.style.display = "none" }
    this._shownAxis = null
  }

  _startEdit(axisId, end) {
    if (this._editing) this._closeEdit()
    this._show(axisId)
    const domain = this._plot.getAxisDomain(axisId)
    const box = this._boxesFor(axisId)[end]
    const value = domain[end === "min" ? 0 : 1]
    const initial = String(Number(value.toPrecision(6)))

    const input = document.createElement("input")
    input.type = "text"
    input.value = initial
    input.spellcheck = false
    input.setAttribute("aria-label", `${axisId} ${end}`)
    Object.assign(input.style, {
      width:      Math.max(64, box.offsetWidth) + "px",
      boxSizing:  "border-box",
      margin:     "0",
      padding:    "0",
      border:     "none",
      outline:    "none",
      background: "transparent",
      font:       "inherit",
      color:      "inherit",
    })
    box.textContent = ""
    box.appendChild(input)
    box.style.cursor = "auto"
    this._editing = { axisId, end, input, initial }
    this._place(axisId, end)

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        if (this._commit()) this._closeEdit()
      } else if (e.key === "Escape") {
        e.preventDefault()
        this._closeEdit()
      } else if (e.key === "Tab") {
        e.preventDefault()
        if (this._commit()) this._startEdit(axisId, end === "min" ? "max" : "min")
      }
    })
    input.addEventListener("blur", () => {
      if (this._editing?.input !== input) return
      this._commit()
      this._closeEdit()
    })
    input.focus()
    input.select()
  }

  // Set the typed value if it is valid. Returns false, and marks the box, if it is not.
  _commit() {
    if (!this._editing) return true
    const { axisId, end, input, initial } = this._editing
    const box = this._boxesFor(axisId)[end]
    if (input.value.trim() === initial) return true
    const plot = this._plot
    const domain = plot.getAxisDomain(axisId)
    if (!domain) return true
    const i = end === "min" ? 0 : 1
    const result = parseAxisLimit(input.value, domain[i], domain[1 - i], plot.axisRegistry.isLogScale(axisId))
    if (result.error) {
      box.style.borderColor = "#d00"
      box.title = result.error
      return false
    }
    const newDomain = domain.slice()
    newDomain[i] = result.value
    // Mark the edit as handled first, so a blur caused by a listener cannot set it twice.
    this._editing.initial = input.value.trim()
    plot._getAxis(axisId).setDomain(newDomain)
    plot._emitAxisLimit({ type: "axislimit", axis: axisId, end, value: result.value, domain: newDomain })
    return true
  }

  _closeEdit() {
    if (!this._editing) return
    const { axisId, end, input } = this._editing
    this._editing = null
    const box = this._boxesFor(axisId)[end]
    input.remove()
    box.style.borderColor = ""
    box.style.cursor = "text"
    box.title = BOX_TITLE
    this._hide()
  }
}
