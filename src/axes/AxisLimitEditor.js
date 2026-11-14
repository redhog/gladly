import { formatTick } from "./Axis.js"
import { AXIS_GEOMETRY } from "./AxisRegistry.js"

const BOX_TITLE = "Type a value for this end"
const DIR_IDX = { x: 0, y: 1, z: 2 }

/**
 * Check a typed axis end value.
 *
 * @param {string}  text  - what was typed; e-notation is accepted ("1e-4")
 * @param {number}  other - the value at the axis's other end
 * @param {boolean} isLog - whether the axis has a log scale
 * @returns {{ value: number } | { error: string }} the parsed value, or why it was refused.
 *   Crossing the other end is allowed — that just reverses the axis, which gladly supports
 *   (a domain with its first value above its second). Only a value equal to the other end
 *   is refused, since it would collapse the axis to zero width.
 */
export function parseAxisLimit(text, other, isLog) {
  const s = String(text).trim()
  const value = Number(s)
  if (s === "" || !Number.isFinite(value)) return { error: "Not a number" }
  if (isLog && value <= 0) return { error: "Must be above 0 on a log axis" }
  if (value === other) return { error: `Must differ from the other end (${formatTick(other)})` }
  return { value }
}

/**
 * Double-click an axis end to type its exact value, in 2D and 3D.
 *
 * A double-click on an axis band opens one text field — at the end nearest the click —
 * pre-filled with that end's current value. Enter sets the value, Tab sets it and moves
 * to the other end, Escape cancels, and leaving the field sets a valid value and drops an
 * invalid one. A value is set through `Axis.setDomain()`, the path zoom and pan take, so
 * linked axes follow; the plot then fires an `'axislimit'` event.
 *
 * The axis under the click comes from `ZoomController._getRegion()` (2D and 3D alike); the
 * end nearest the click comes from the sign of the click's `_unproject`ed position along
 * the axis direction, which is a screen/positional judgement and so stays correct on log
 * and reversed axes. The field is placed by `ZoomController.axisEndScreenPos()`.
 */
export class AxisLimitEditor {
  constructor(plot) {
    this._plot = plot
    this._editing = null   // { axisId, end, box, input, initial }
    this._onDblClick = (e) => this._handleDblClick(e)
    plot._canvas.addEventListener("dblclick", this._onDblClick)
  }

  destroy() {
    this._plot._canvas.removeEventListener("dblclick", this._onDblClick)
    this._closeEdit()
  }

  _isDrawn(axisId) {
    const plot = this._plot
    return !!plot.axisRegistry?.getScale(axisId) && plot.currentConfig?.axes?.[axisId]?.visible !== false
  }

  _handleDblClick(e) {
    const plot = this._plot
    if (!plot.axisRegistry || !plot._zoomController || !plot._isReady()) return
    const rect = plot.container.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const region = plot._zoomController._getRegion(mx, my)
    if (region?.type !== "axis") return
    const axisId = region.axes[0]
    if (!this._isDrawn(axisId)) return
    // Which end: the sign of the click's unprojected position along the axis direction.
    // Normalised axis space runs -1 (min end) → +1 (max end) on the dir component.
    const world = plot._zoomController._unproject(mx, my)
    const end = world[DIR_IDX[AXIS_GEOMETRY[axisId].dir]] < 0 ? "min" : "max"
    this._startEdit(axisId, end)
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
      boxSizing:    "border-box",
      padding:      "0 3px",
      font:         "11px sans-serif",
      lineHeight:   "16px",
      color:        "#000",
      background:   "#fff",
      border:       "1px solid #888",
      borderRadius: "2px",
      whiteSpace:   "nowrap",
    })
    // A press on the box padding must not take focus away from the open field.
    box.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "INPUT") e.preventDefault()
    })
    return box
  }

  // Center the open box on its end, kept inside the container.
  _place() {
    if (!this._editing) return
    const { axisId, end, box } = this._editing
    const pos = this._plot._zoomController.axisEndScreenPos(axisId, end)
    if (!pos) return
    const W = this._plot.container.clientWidth, H = this._plot.container.clientHeight
    const bw = box.offsetWidth, bh = box.offsetHeight
    box.style.left = Math.max(0, Math.min(W - bw, pos[0] - bw / 2)) + "px"
    box.style.top  = Math.max(0, Math.min(H - bh, pos[1] - bh / 2)) + "px"
  }

  _startEdit(axisId, end) {
    if (this._editing) this._closeEdit()
    const plot = this._plot
    const domain = plot.getAxisDomain(axisId)
    if (!domain) return
    const value = domain[end === "min" ? 0 : 1]
    const initial = String(Number(value.toPrecision(6)))

    const box = this._makeBox(axisId, end)
    const input = document.createElement("input")
    input.type = "text"
    input.value = initial
    input.spellcheck = false
    input.setAttribute("aria-label", `${axisId} ${end}`)
    Object.assign(input.style, {
      width:      Math.max(48, initial.length * 7 + 10) + "px",
      boxSizing:  "border-box",
      margin:     "0",
      padding:    "0",
      border:     "none",
      outline:    "none",
      background: "transparent",
      font:       "inherit",
      color:      "inherit",
    })
    box.appendChild(input)
    plot.container.appendChild(box)
    // A press outside the box closes the editor. We cannot rely on the input blurring,
    // since the canvas' own mousedown calls preventDefault(), which suppresses the blur.
    const onOutsideDown = (e) => {
      if (!this._editing || this._editing.box.contains(e.target)) return
      this._commit()
      this._closeEdit()
    }
    document.addEventListener("mousedown", onOutsideDown, true)
    this._editing = { axisId, end, box, input, initial, onOutsideDown }
    this._place()

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
    const { axisId, end, box, input, initial } = this._editing
    if (input.value.trim() === initial) return true
    const plot = this._plot
    const domain = plot.getAxisDomain(axisId)
    if (!domain) return true
    const i = end === "min" ? 0 : 1
    const result = parseAxisLimit(input.value, domain[1 - i], plot.axisRegistry.isLogScale(axisId))
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
    const { box, onOutsideDown } = this._editing
    this._editing = null
    document.removeEventListener("mousedown", onOutsideDown, true)
    box.remove()
  }
}
