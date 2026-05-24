import { ColumnData } from '../data/ColumnData.js'
import { globalSelectionRegistry } from './SelectionRegistry.js'

export class Selection extends ColumnData {
  constructor(plot, name) {
    super()
    this._plot = plot
    this._name = name
    this._packed = null   // Float32Array (texW*texH*4) from last GPU readback, or null
    this._listeners = new Set()
    this._propagating = false
  }

  // ─── ColumnData interface — delegates to the SelectionColumn for this plot ───

  get length()       { return this._column?.length ?? null }
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

  // One Float32 (0 or 1) per data point. null when no selection is active.
  get array() {
    if (!this.active || !this._packed) return null
    const n = this.length
    if (n == null) return null
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = this._packed[i] > 0.5 ? 1 : 0
    return out
  }

  // Returns { remove() } handle, like plot.on().
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

  // Called by Plot.selectLasso() after the GPU pipeline completes.
  // Reads the GPU texture back to CPU, updates active state, and notifies subscribers.
  _readbackAndNotify() {
    const col = this._column
    if (!col) return

    const pixelCount = col.texW * col.texH * 4
    const packed = new Float32Array(pixelCount)
    this._plot.regl({ framebuffer: col.fbo })(() => {
      this._plot.regl.read({ data: packed })
    })

    if (packed.some(v => v > 0.5)) {
      col.activate()
      this._packed = packed
    } else {
      col.clear()
      this._packed = null
    }

    this._plot.scheduleRender()
    this._notify()
  }

  // Called by linkSelections() subscribers to apply a packed CPU buffer from another plot.
  _applyFromCpu(packed) {
    const col = this._column
    if (!col) return

    if (!packed || !packed.some(v => v > 0.5)) {
      col.clear()
      this._packed = null
    } else {
      col.upload(packed)
      this._packed = packed
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
