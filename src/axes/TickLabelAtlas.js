// Canvas-backed texture atlas for tick and axis title labels.
// Labels are rendered with Canvas 2D and packed into a single GPU texture (shelf packing).
// UV coordinates use the convention: v = canvas_y / ATLAS_SIZE (v=0 = canvas top).
// The atlas texture is uploaded with flipY: false, so texture(sampler, (u,v)) samples
// canvas pixel (u*W, v*H). Billboard quads use matching UV assignments.

const ATLAS_SIZE  = 1024
const FONT        = '12px sans-serif'
const PADDING     = 2
const ROW_HEIGHT  = 16   // fixed text-line height in pixels

export class TickLabelAtlas {
  constructor(regl) {
    this._regl   = regl
    this._canvas = null
    this._ctx    = null
    this._texture     = null
    this._entries     = new Map()   // text → { u, v, uw, vh, pw, ph } | null (pending)
    this._needsRebuild = false
  }

  // Mark a set of label strings as needed. Call before flush().
  markLabels(labels) {
    for (const l of labels) {
      if (!this._entries.has(l)) {
        this._entries.set(l, null)
        this._needsRebuild = true
      }
    }
  }

  // Re-render the atlas canvas and re-upload the GPU texture if anything changed.
  flush() {
    if (!this._needsRebuild) return
    this._needsRebuild = false

    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.width  = ATLAS_SIZE
      this._canvas.height = ATLAS_SIZE
      this._ctx = this._canvas.getContext('2d')
    }

    const ctx = this._ctx
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
    ctx.font         = FONT
    ctx.fillStyle    = '#000'
    ctx.textBaseline = 'top'

    const rowH = ROW_HEIGHT + PADDING * 2
    let x = 0, y = 0

    for (const label of this._entries.keys()) {
      const metrics = ctx.measureText(label)
      const pw = Math.ceil(metrics.width) + PADDING * 2
      const ph = rowH

      if (x + pw > ATLAS_SIZE) { x = 0; y += rowH }
      if (y + ph > ATLAS_SIZE) {
        console.warn('[gladly] TickLabelAtlas: atlas is full; some labels may be missing')
        break
      }

      ctx.fillText(label, x + PADDING, y + PADDING)

      this._entries.set(label, {
        u:  x  / ATLAS_SIZE,
        v:  y  / ATLAS_SIZE,
        uw: pw / ATLAS_SIZE,
        vh: ph / ATLAS_SIZE,
        pw,
        ph,
      })
      x += pw
    }

    if (this._texture) this._texture.destroy()
    // flipY: false — v = canvas_y / ATLAS_SIZE; v=0 samples canvas top.
    this._texture = this._regl.texture({
      data:   this._canvas,
      format: 'rgba',
      mag:    'linear',
      min:    'linear',
      flipY:  false,
    })
  }

  // Returns the atlas entry for a label, or null if it hasn't been built yet.
  getEntry(label) { return this._entries.get(label) ?? null }

  get texture() { return this._texture }

  destroy() {
    if (this._texture) { this._texture.destroy(); this._texture = null }
  }
}
