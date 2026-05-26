import { ColumnData } from '../data/ColumnData.js'
import { globalSelectionRegistry } from './SelectionRegistry.js'

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export class Selection extends ColumnData {
  constructor(plot, name) {
    super()
    this._plot   = plot
    this._name   = name
    this._arrays = null   // Float32Array[] — one per tile, values 0 or 1; null when inactive
    this._listeners   = new Set()
    this._propagating = false
  }

  // ─── ColumnData interface ────────────────────────────────────────────────────

  get length()       { return this._column?._tiles.reduce((s, t) => s + t.n, 0) ?? null }
  get domain()       { return [0, 1] }
  get quantityKind() { return null }

  resolve(path, regl) {
    const col = this._column
    if (!col) throw new Error(`[gladly] Selection '${this._name}': no column registered — add a layer with selection: '${this._name}'`)
    return col.resolve(path, regl)
  }

  toTexture(regl) {
    const col = this._column
    if (!col) throw new Error(`[gladly] Selection '${this._name}': no column registered — add a layer with selection: '${this._name}'`)
    return col.toTexture(regl)
  }

  refresh(plot) { return this._column?.refresh(plot) ?? false }

  // ─── Public API ──────────────────────────────────────────────────────────────

  get active() { return this._column?.active ?? false }

  // One Float32Array per tile (values 0 or 1). Mirrors toTexture() for CPU access.
  // Returns null when no lasso has been drawn or no points are selected.
  // arrays[t][i] == 1 means local point i within tile t is selected.
  get arrays() { return this._arrays }

  clear() {
    const col = this._column
    if (col) col.clear()
    this._arrays = null
    this._plot.scheduleRender()
    this._notify()
  }

  applyFrom(otherSel) {
    const arrays   = otherSel._arrays
    const col      = this._column
    const otherCol = otherSel._column
    if (!col || !otherCol) return

    col._onClear = () => { this._arrays = null; this._notify() }

    const otherSizes = otherCol._tiles.map(t => t.n)
    if (!arraysEqual(col._tiles.map(t => t.n), otherSizes)) {
      const saved   = col._onClear
      col._onClear  = null
      col._rebuild(otherSizes)
      col._onClear  = saved
    }

    if (!arrays || !arrays.some(a => a.some(v => v > 0.5))) {
      col.clear()
      this._arrays = null
    } else {
      col.upload(arrays)
      this._arrays = arrays
    }
    this._plot.scheduleRender()
    this._notify()
  }

  subscribe(callback) {
    this._listeners.add(callback)
    return { remove: () => this._listeners.delete(callback) }
  }

  unsubscribe(callback) { this._listeners.delete(callback) }

  // ─── Internal ────────────────────────────────────────────────────────────────

  get _column() {
    const dataRef = this._plot._lastRawDataArg
    if (dataRef == null) return null
    return globalSelectionRegistry.get(dataRef, this._name, this._plot)
  }

  _readbackAndNotify() {
    const col = this._column
    if (!col) return

    col._onClear = () => { this._arrays = null; this._notify() }

    // Read each tile's FBO; keep as separate Float32Array per tile (values 0 or 1).
    const arrays = col._tiles.map(tile => {
      const raw = new Float32Array(tile.texW * tile.texH * 4)
      this._plot.regl({ framebuffer: tile.fbo })(() => {
        this._plot.regl.read({ data: raw })
      })
      return raw.slice(0, tile.n)   // trim padding; .slice gives a fresh copy
    })

    if (arrays.some(a => a.some(v => v > 0.5))) {
      col.activate()
      this._arrays = arrays
    } else {
      col.clear()
      this._arrays = null
    }

    this._plot.scheduleRender()
    this._notify()
  }

  _notify() {
    if (this._propagating) return
    this._propagating = true
    try {
      for (const cb of this._listeners) cb(this)
    } finally {
      this._propagating = false
    }
  }
}
