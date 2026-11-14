import { AXES } from "../axes/AxisRegistry.js"
import { getAxisQuantityKind } from "../axes/AxisQuantityKindRegistry.js"

// Human-readable side name for an axis slot. The 2D sides are named outright; a 3D slot
// falls back to its direction letter plus its position suffix (e.g. "X bottom back").
const SIDE_2D = { xaxis_bottom: 'Bottom', xaxis_top: 'Top', yaxis_left: 'Left', yaxis_right: 'Right' }
function sideLabel(slot) {
  if (SIDE_2D[slot]) return SIDE_2D[slot]
  const m = slot.match(/^([xyz])axis_?(.*)$/)
  if (m) return (m[1].toUpperCase() + (m[2] ? ' ' + m[2].replace(/_/g, ' ') : ''))
  return slot
}

// The four axis-part toggles, in display order. `key` is the axes.<slot> config key each
// writes; `col` is its column header. Axis is the whole-axis switch; Lock is the range lock.
const TOGGLES = [
  { key: 'visible',           col: 'Axis'   },
  { key: 'tickLabelsVisible', col: 'Labels' },
  { key: 'titleVisible',      col: 'Title'  },
  { key: 'locked',            col: 'Lock'   },
]

/**
 * gladly's built-in right-click axis menu. Opened by Plot._emitContextMenu() for a
 * 'contextmenu' press, gated by the top-level `plot_menu` (full menu) and `axis_menu`
 * (single-axis menu) config booleans.
 *
 * The menu holds no axis state of its own: every row reads the live config, each toggle
 * writes an axes.<slot> key (Axis/Labels/Title through update(), Lock through
 * setAxisLocked()) or calls resetAxes()/setDomain(null), and the change round-trips
 * through getConfig() and emits 'axisoptions' from the write path — not from here.
 */
export class AxisMenu {
  constructor(plot) {
    this._plot = plot
    this._el = null
    this._rows = []            // [{ slot, boxes: { key: <input> } }]
    this._onKey = (e) => { if (e.key === 'Escape') this.close() }
    this._onOutsideDown = (e) => { if (this._el && !this._el.contains(e.target)) this.close() }
  }

  // The slots a right-click resolves to: one axis strip, or every spatial axis with a scale.
  _slotsFor(region) {
    if (region?.type === 'axis') return region.axes.slice(0, 1)
    const ar = this._plot.axisRegistry
    return AXES.filter(a => ar?.getScale(a))
  }

  _rowTitle(slot) {
    const qk = this._plot.axisRegistry?.getQkForSlot(slot)
    const cfg = this._plot.currentConfig?.axes?.[slot] ?? {}
    const title = cfg.label ?? (qk ? getAxisQuantityKind(qk).label : '') ?? ''
    return title ? `${sideLabel(slot)}: ${title}` : sideLabel(slot)
  }

  // clientX/clientY are viewport coordinates (the event's own). The menu is attached to
  // document.body with position:fixed so it escapes any float's overflow:hidden clip and
  // its stacking context — a right-click on a colorbar/filterbar float's axis would
  // otherwise be cropped to the float and painted under it.
  open(clientX, clientY, region) {
    this.close()
    const plot = this._plot
    const slots = this._slotsFor(region)
    if (slots.length === 0) return
    const singleAxis = region?.type === 'axis'

    const el = document.createElement('div')
    el.setAttribute('data-gladly-control', 'axis-menu')
    Object.assign(el.style, {
      // Max int32 z-index so it sits above floats (whose z-index climbs with use).
      position: 'fixed', zIndex: '2147483647', boxSizing: 'border-box',
      padding: '4px', font: '12px sans-serif', color: '#000',
      background: '#fff', border: '1px solid #888', borderRadius: '3px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', userSelect: 'none',
    })
    // A press on the menu chrome must not blur/close it (only presses outside do).
    el.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() })

    const table = document.createElement('table')
    table.style.borderCollapse = 'collapse'

    const head = document.createElement('tr')
    head.appendChild(document.createElement('th'))  // empty corner above the row names
    for (const t of TOGGLES) {
      const th = document.createElement('th')
      th.textContent = t.col
      Object.assign(th.style, { padding: '2px 5px', fontWeight: 'normal', color: '#555' })
      head.appendChild(th)
    }
    table.appendChild(head)

    this._rows = []
    for (const slot of slots) {
      const tr = document.createElement('tr')
      const nameCell = document.createElement('td')
      nameCell.textContent = this._rowTitle(slot)
      Object.assign(nameCell.style, { padding: '2px 8px 2px 2px' })
      tr.appendChild(nameCell)

      const boxes = {}
      for (const t of TOGGLES) {
        const td = document.createElement('td')
        td.style.textAlign = 'center'
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.setAttribute('aria-label', `${slot} ${t.col}`)
        box.setAttribute('data-axis', slot)
        box.setAttribute('data-key', t.key)
        box.addEventListener('change', () => this._onToggle(slot, t.key, box.checked))
        td.appendChild(box)
        tr.appendChild(td)
        boxes[t.key] = box
      }
      table.appendChild(tr)
      this._rows.push({ slot, boxes })
    }
    el.appendChild(table)

    // Reset: the full menu resets the whole view; a single-axis menu resets just that axis.
    const reset = document.createElement('button')
    reset.textContent = singleAxis ? 'Reset axis' : 'Reset view'
    Object.assign(reset.style, {
      display: 'block', width: '100%', marginTop: '4px', padding: '3px',
      font: 'inherit', cursor: 'pointer',
    })
    reset.addEventListener('click', () => {
      if (singleAxis) plot.axes[slots[0]].setDomain(null)
      else plot.resetAxes()
      this.close()
    })
    el.appendChild(reset)

    document.body.appendChild(el)
    this._el = el
    this._refresh()
    this._place(clientX, clientY)

    document.addEventListener('mousedown', this._onOutsideDown, true)
    window.addEventListener('keydown', this._onKey)
  }

  // Keep the menu inside the viewport, preferring the pointer as its top-left corner.
  _place(clientX, clientY) {
    const w = this._el.offsetWidth, h = this._el.offsetHeight
    this._el.style.left = Math.max(0, Math.min(window.innerWidth  - w, clientX)) + 'px'
    this._el.style.top  = Math.max(0, Math.min(window.innerHeight - h, clientY)) + 'px'
  }

  // Read live state into every checkbox: visibility keys default true, lock reads
  // isAxisLocked (so a same-QK sibling lock shows checked); a hidden axis greys out its
  // Labels and Title boxes but keeps their checked state. Lock stays live when hidden.
  _refresh() {
    const axes = this._plot.currentConfig?.axes ?? {}
    for (const { slot, boxes } of this._rows) {
      const cfg = axes[slot] ?? {}
      const visible = cfg.visible !== false
      boxes.visible.checked           = visible
      boxes.tickLabelsVisible.checked = cfg.tickLabelsVisible !== false
      boxes.titleVisible.checked      = cfg.titleVisible !== false
      boxes.locked.checked            = this._plot.isAxisLocked(slot)
      boxes.tickLabelsVisible.disabled = !visible
      boxes.titleVisible.disabled      = !visible
    }
  }

  async _onToggle(slot, key, value) {
    const plot = this._plot
    if (key === 'locked') {
      plot.setAxisLocked(slot, value)   // render-only, no layer rebuild
    } else {
      // Visible / Labels / Title go through the config path so the margin reflows.
      const config = plot.currentConfig ?? {}
      const axes = { ...(config.axes ?? {}) }
      axes[slot] = { ...(axes[slot] ?? {}), [key]: value }
      await plot.update({ config: { ...config, axes } })
    }
    if (this._el) this._refresh()
  }

  close() {
    if (!this._el) return
    document.removeEventListener('mousedown', this._onOutsideDown, true)
    window.removeEventListener('keydown', this._onKey)
    this._el.remove()
    this._el = null
    this._rows = []
  }

  destroy() {
    this.close()
  }
}
