import { AXES } from "../axes/AxisRegistry.js"
import { getAxisQuantityKind } from "../axes/AxisQuantityKindRegistry.js"
import { getRegisteredColorscales, getRegistered2DColorscales } from "../colorscales/ColorscaleRegistry.js"

// Human-readable side name for an axis slot. The 2D sides are named outright; a 3D slot
// falls back to its direction letter plus its position suffix (e.g. "X bottom back").
const SIDE_2D = { xaxis_bottom: 'Bottom', xaxis_top: 'Top', yaxis_left: 'Left', yaxis_right: 'Right' }
function sideLabel(slot) {
  if (SIDE_2D[slot]) return SIDE_2D[slot]
  const m = slot.match(/^([xyz])axis_?(.*)$/)
  if (m) return (m[1].toUpperCase() + (m[2] ? ' ' + m[2].replace(/_/g, ' ') : ''))
  return slot
}
function qkLabel(qk) { return getAxisQuantityKind(qk).label ?? qk }

// The spatial axis-part toggles, in display order. `key` is the axes.<slot> config key
// each writes; `col` is its column header. `scale` marks the log toggle, which maps a
// boolean checkbox to the string `scale` key ('log' when on, 'linear' when off).
const TOGGLES = [
  { key: 'visible',           col: 'Axis'   },
  { key: 'tickLabelsVisible', col: 'Labels' },
  { key: 'titleVisible',      col: 'Title'  },
  { key: 'locked',            col: 'Lock'   },
  { key: 'scale',             col: 'Log', scale: true },
]

// A colour/filter bar is a tri-state: none → vertical → horizontal → none, shown as an icon.
const BAR_STATES = ['none', 'vertical', 'horizontal']
const BAR_GLYPH  = { none: '▢', vertical: '▮', horizontal: '▬' }
const BAR_TITLE  = { none: 'No bar', vertical: 'Vertical bar', horizontal: 'Horizontal bar' }

/**
 * gladly's built-in right-click axis menu. Opened by Plot._emitContextMenu() for a
 * 'contextmenu' press, gated by the top-level `plot_menu` (full menu) and `axis_menu`
 * (single-axis menu) config booleans.
 *
 * The full menu shows a spatial-axis table (Axis / Labels / Title / Lock / Log per axis)
 * and, below it, a table of the plot's colour, 2D-colour and filter axes (colorscale, bar
 * and — for a 2D pair — enabled). The single-axis menu shows just the one spatial row.
 *
 * The menu holds no state of its own: every control reads the live config, and each change
 * writes an axes.<slot> key / a colorbars entry (Axis2d) / calls setAxisLocked() /
 * resetAxes()-setDomain(null). Writes round-trip through getConfig() and emit 'axisoptions'
 * from the write path — not from here.
 */
export class AxisMenu {
  constructor(plot) {
    this._plot = plot
    this._el = null
    this._refreshers = []      // () => void, each re-reads live config into one control
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
    const title = cfg.label ?? (qk ? qkLabel(qk) : '') ?? ''
    return title ? `${sideLabel(slot)}: ${title}` : sideLabel(slot)
  }

  // ─── Reusable cell controls ────────────────────────────────────────────────

  // A checkbox whose live value comes from get() and whose change calls set(checked).
  _checkbox(get, set, { disabled } = {}) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.addEventListener('change', () => set(box.checked))
    this._refreshers.push(() => { box.checked = !!get(); if (disabled) box.disabled = disabled() })
    return box
  }

  // A tri-state bar icon cycling none → vertical → horizontal → none on click.
  _barTri(get, set) {
    const span = document.createElement('span')
    span.setAttribute('role', 'button')
    Object.assign(span.style, { cursor: 'pointer', display: 'inline-block', minWidth: '1.4em', textAlign: 'center' })
    span.addEventListener('click', () => set(BAR_STATES[(BAR_STATES.indexOf(get()) + 1) % BAR_STATES.length]))
    this._refreshers.push(() => { const v = get(); span.textContent = BAR_GLYPH[v] ?? BAR_GLYPH.none; span.title = BAR_TITLE[v] ?? '' })
    return span
  }

  // A colorscale dropdown; `options` is the list of names, `get`/`set` the live value.
  _colorscaleSelect(options, get, set) {
    const sel = document.createElement('select')
    sel.style.font = 'inherit'
    for (const name of options) {
      const o = document.createElement('option')
      o.value = name; o.textContent = name === '' ? '(default)' : name
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => set(sel.value))
    this._refreshers.push(() => { sel.value = get() ?? '' })
    return sel
  }

  open(e, coords, region) {
    this.close()
    const plot = this._plot
    const slots = this._slotsFor(region)
    if (slots.length === 0) return
    const singleAxis = region?.type === 'axis'
    this._refreshers = []

    const el = document.createElement('div')
    el.setAttribute('data-gladly-control', 'axis-menu')
    Object.assign(el.style, {
      // Attached to document.body with position:fixed so it escapes any float's
      // overflow:hidden clip and stacking context; max int32 z-index so it sits above
      // floats (whose z-index climbs with use).
      position: 'fixed', zIndex: '2147483647', boxSizing: 'border-box',
      padding: '4px', font: '12px sans-serif', color: '#000',
      background: '#fff', border: '1px solid #888', borderRadius: '3px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', userSelect: 'none',
    })
    // A press on the menu chrome must not blur/close it (only presses outside do).
    el.addEventListener('mousedown', (e) => { if (!/^(INPUT|SELECT|OPTION)$/.test(e.target.tagName)) e.preventDefault() })

    el.appendChild(this._buildSpatialTable(slots))
    // The colour / 2D-colour / filter table is plot-wide, so only the full menu shows it.
    if (!singleAxis) {
      const extra = this._buildExtraTable()
      if (extra) el.appendChild(extra)
    }
    el.appendChild(this._buildReset(slots, singleAxis))

    document.body.appendChild(el)
    this._el = el
    this._refresh()
    // After build + refresh (DOM complete, controls showing live values) and before place
    // (so _place measures the final size), let 'contextmenu_open' listeners mutate the menu.
    this._plot._emitContextMenuOpen(e, coords, region, el)
    this._place(e.clientX, e.clientY)

    document.addEventListener('mousedown', this._onOutsideDown, true)
    window.addEventListener('keydown', this._onKey)
  }

  // ─── Spatial axis table: Axis / Labels / Title / Lock / Log per axis ─────────
  _buildSpatialTable(slots) {
    const plot = this._plot
    const table = document.createElement('table')
    table.setAttribute('data-table', 'spatial')
    table.style.borderCollapse = 'collapse'

    const head = document.createElement('tr')
    head.appendChild(document.createElement('th'))
    for (const t of TOGGLES) {
      const th = document.createElement('th')
      th.textContent = t.col
      Object.assign(th.style, { padding: '2px 5px', fontWeight: 'normal', color: '#555' })
      head.appendChild(th)
    }
    table.appendChild(head)

    for (const slot of slots) {
      const qk = plot.axisRegistry?.getQkForSlot(slot)
      const tr = document.createElement('tr')
      const nameCell = document.createElement('td')
      nameCell.textContent = this._rowTitle(slot)
      nameCell.style.padding = '2px 8px 2px 2px'
      tr.appendChild(nameCell)

      for (const t of TOGGLES) {
        const td = document.createElement('td')
        td.style.textAlign = 'center'
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.setAttribute('aria-label', `${slot} ${t.col}`)
        box.setAttribute('data-axis', slot)
        box.setAttribute('data-key', t.key)
        box.addEventListener('change', () => this._onToggle(slot, t.key, box.checked))
        this._refreshers.push(() => {
          const cfg = plot.currentConfig?.axes?.[slot] ?? {}
          if (t.key === 'locked')      box.checked = plot.isAxisLocked(slot)
          else if (t.scale)            box.checked = (cfg.scale ?? (qk ? getAxisQuantityKind(qk).scale : 'linear')) === 'log'
          else                         box.checked = cfg[t.key] !== false
          if (t.key === 'tickLabelsVisible' || t.key === 'titleVisible') box.disabled = cfg.visible === false
        })
        td.appendChild(box)
        tr.appendChild(td)
      }
      table.appendChild(tr)
    }
    return table
  }

  // ─── Colour / 2D-colour / filter table (plot-wide) ───────────────────────────
  // Columns: Name | Colorscale | Bar | Enabled. Colour axes have a colorscale dropdown and
  // a tri-state bar; 2D pairs add an enabled checkbox and use a plain bar checkbox; filter
  // axes have only a tri-state bar. Returns null when the plot has none of these.
  _buildExtraTable() {
    const plot = this._plot
    const ar = plot.axisRegistry
    if (!ar) return null
    const colorQks  = ar.getColorQuantityKinds()
    const filterQks = ar.getFilterQuantityKinds()
    const pairKeys  = plot._axis2dKeys()
    if (colorQks.length === 0 && filterQks.length === 0 && pairKeys.length === 0) return null

    const cs1d = [...getRegisteredColorscales().keys()]
    const cs2d = [...getRegistered2DColorscales().keys()]

    const table = document.createElement('table')
    table.setAttribute('data-table', 'color-filter')
    Object.assign(table.style, { borderCollapse: 'collapse', marginTop: '4px', borderTop: '1px solid #ddd', paddingTop: '2px' })

    const head = document.createElement('tr')
    for (const label of ['', 'Colorscale', 'Bar', 'Enabled']) {
      const th = document.createElement('th')
      th.textContent = label
      Object.assign(th.style, { padding: '2px 5px', fontWeight: 'normal', color: '#555' })
      head.appendChild(th)
    }
    table.appendChild(head)

    const row = (name, attrs) => {
      const tr = document.createElement('tr')
      for (const [k, v] of Object.entries(attrs)) tr.setAttribute(k, v)
      const nameCell = document.createElement('td')
      nameCell.textContent = name
      nameCell.style.padding = '2px 8px 2px 2px'
      tr.appendChild(nameCell)
      return tr
    }
    const cell = (child) => { const td = document.createElement('td'); td.style.textAlign = 'center'; if (child) td.appendChild(child); return td }

    // Colour axes
    for (const qk of colorQks) {
      const tr = row(qkLabel(qk), { 'data-color': qk })
      const sel = this._colorscaleSelect(['', ...cs1d],
        () => plot.currentConfig?.axes?.[qk]?.colorscale ?? ar.getColorscale(qk) ?? '',
        (v) => this._writeAxisKey(qk, 'colorscale', v))
      sel.setAttribute('data-color', qk); sel.setAttribute('data-key', 'colorscale')
      const bar = this._barTri(
        () => plot.currentConfig?.axes?.[qk]?.colorbar ?? 'none',
        (v) => this._writeAxisKey(qk, 'colorbar', v))
      bar.setAttribute('data-color', qk); bar.setAttribute('data-key', 'colorbar')
      tr.appendChild(cell(sel)); tr.appendChild(cell(bar)); tr.appendChild(cell(null))
      table.appendChild(tr)
    }

    // 2D colour pairs
    for (const key of pairKeys) {
      const a2d = plot.axis2d[key]
      const tr = row(`${qkLabel(a2d.xAxis)} × ${qkLabel(a2d.yAxis)}`, { 'data-axis2d': key })
      const sel = this._colorscaleSelect(['none', ...cs2d],
        () => a2d.getConfig().colorscale ?? 'none',
        (v) => a2d.setConfig({ colorscale: v }).then(() => this._el && this._refresh()))
      sel.setAttribute('data-axis2d', key); sel.setAttribute('data-key', 'colorscale')
      const bar = this._checkbox(
        () => a2d.getConfig().colorbar !== false,
        (v) => a2d.setConfig({ colorbar: v }).then(() => this._el && this._refresh()))
      bar.setAttribute('data-axis2d', key); bar.setAttribute('data-key', 'colorbar')
      const enabled = this._checkbox(
        () => a2d.getConfig().enabled !== false,
        (v) => a2d.setConfig({ enabled: v }).then(() => this._el && this._refresh()))
      enabled.setAttribute('data-axis2d', key); enabled.setAttribute('data-key', 'enabled')
      tr.appendChild(cell(sel)); tr.appendChild(cell(bar)); tr.appendChild(cell(enabled))
      table.appendChild(tr)
    }

    // Filter axes
    for (const qk of filterQks) {
      const tr = row(qkLabel(qk), { 'data-filter': qk })
      const bar = this._barTri(
        () => plot.currentConfig?.axes?.[qk]?.filterbar ?? 'none',
        (v) => this._writeAxisKey(qk, 'filterbar', v))
      bar.setAttribute('data-filter', qk); bar.setAttribute('data-key', 'filterbar')
      tr.appendChild(cell(null)); tr.appendChild(cell(bar)); tr.appendChild(cell(null))
      table.appendChild(tr)
    }

    return table
  }

  _buildReset(slots, singleAxis) {
    const plot = this._plot
    const reset = document.createElement('button')
    reset.textContent = singleAxis ? 'Reset axis' : 'Reset view'
    Object.assign(reset.style, { display: 'block', width: '100%', marginTop: '4px', padding: '3px', font: 'inherit', cursor: 'pointer' })
    reset.addEventListener('click', () => {
      if (singleAxis) plot.axes[slots[0]].setDomain(null)
      else plot.resetAxes()
      this.close()
    })
    return reset
  }

  // Keep the menu inside the viewport, preferring the pointer as its top-left corner.
  _place(clientX, clientY) {
    const w = this._el.offsetWidth, h = this._el.offsetHeight
    this._el.style.left = Math.max(0, Math.min(window.innerWidth  - w, clientX)) + 'px'
    this._el.style.top  = Math.max(0, Math.min(window.innerHeight - h, clientY)) + 'px'
  }

  // Re-read live state into every control (checkbox state/disabled, bar glyph, select value).
  _refresh() { for (const fn of this._refreshers) fn() }

  // Toggle a spatial axis-part: lock is render-only; scale maps a boolean to 'log'/'linear';
  // the rest write their boolean key through the config path so the margin reflows.
  async _onToggle(slot, key, value) {
    if (key === 'locked') { this._plot.setAxisLocked(slot, value); if (this._el) this._refresh(); return }
    if (key === 'scale')  return this._writeAxisKey(slot, 'scale', value ? 'log' : 'linear')
    return this._writeAxisKey(slot, key, value)
  }

  // Write one axes.<slot> key (spatial, colour or filter) and re-apply through update().
  async _writeAxisKey(slot, key, value) {
    const config = this._plot.currentConfig ?? {}
    const axes = { ...(config.axes ?? {}) }
    axes[slot] = { ...(axes[slot] ?? {}), [key]: value }
    await this._plot.update({ config: { ...config, axes } })
    if (this._el) this._refresh()
  }

  close() {
    if (!this._el) return
    document.removeEventListener('mousedown', this._onOutsideDown, true)
    window.removeEventListener('keydown', this._onKey)
    this._el.remove()
    this._el = null
    this._refreshers = []
  }

  destroy() { this.close() }
}
