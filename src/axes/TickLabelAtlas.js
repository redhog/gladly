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

  // A canvas 2D context with the atlas font set, for measuring strings before (or
  // without) packing them. Created lazily; reused for packing in flush().
  _ensureCtx() {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.width  = ATLAS_SIZE
      this._canvas.height = ATLAS_SIZE
      this._ctx = this._canvas.getContext('2d')
    }
    this._ctx.font = FONT
    return this._ctx
  }

  // The rendered pixel size of a string — the same { pw, ph } a packed entry gets —
  // measured from the atlas font. Lets callers size layout to the real font metrics
  // (not a hard-coded line height) without the string being in the atlas yet.
  measure(text) {
    const ctx = this._ensureCtx()
    return { pw: Math.ceil(ctx.measureText(text).width) + PADDING * 2, ph: ROW_HEIGHT + PADDING * 2 }
  }

  // The rendered height of one text line in px (every entry's ph), and the padding
  // used as the small inter-band gap. Both come from the atlas font, not a constant
  // in the axis code.
  get lineHeight() { return ROW_HEIGHT + PADDING * 2 }
  get gap()        { return PADDING }

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

    const ctx = this._ensureCtx()
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
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

    // flipY: false — v = canvas_y / ATLAS_SIZE; v=0 samples canvas top.
    if (!this._texture) {
      this._texture = this._regl.texture({
        width:  ATLAS_SIZE,
        height: ATLAS_SIZE,
        format: 'rgba',
        mag:    'nearest',
        min:    'nearest',
        flipY:  false,
      })
    }
    this._texture.subimage({ data: this._canvas, x: 0, y: 0, flipY: false })
  }

  // Returns the atlas entry for a label, or null if it hasn't been built yet.
  getEntry(label) { return this._entries.get(label) ?? null }

  get texture() { return this._texture }

  destroy() {
    if (this._texture) { this._texture.destroy(); this._texture = null }
  }
}
