import { AXIS_GEOMETRY, axisEndpoints, axisPosAtN } from "./AxisRegistry.js"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"
import { projectToScreen } from "../math/mat4.js"
import { Plot } from "../core/Plot.js"

// ─── Tick formatting (same logic as before) ───────────────────────────────────

export function formatTick(v) {
  if (v === 0) return "0"
  const abs = Math.abs(v)
  if (abs >= 10000 || abs < 0.01) {
    return v.toExponential(2).replace(/\.?0+(e)/, '$1')
  }
  const s = v.toPrecision(4)
  if (s.includes('.') && !s.includes('e')) return s.replace(/\.?0+$/, '')
  return s
}

function logTickValues(scale, count) {
  const [dMin, dMax] = scale.domain()
  if (dMin <= 0 || dMax <= 0) return null
  const logMin = Math.log10(dMin), logMax = Math.log10(dMax)
  const startExp = Math.floor(logMin), endExp = Math.ceil(logMax)
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
  if (candidate.length >= 2 && candidate.length <= count) return candidate
  const firstExp = Math.ceil(logMin), lastExp = Math.floor(logMax)
  if (firstExp > lastExp) return candidate.length >= 2 ? candidate : null
  const numPowers = lastExp - firstExp + 1
  const step = numPowers > count ? Math.ceil(numPowers / count) : 1
  const powers = []
  for (let e = firstExp; e <= lastExp; e += step) powers.push(Math.pow(10, e))
  return powers.length >= 2 ? powers : null
}

// Normalise a data value to [0,1] within its domain (matches GLSL normalize_axis).
function normaliseValue(v, domain, isLog) {
  const vt = isLog ? Math.log(v)        : v
  const d0 = isLog ? Math.log(domain[0]) : domain[0]
  const d1 = isLog ? Math.log(domain[1]) : domain[1]
  return (vt - d0) / (d1 - d0)
}

// ─── Tick mark / label geometry constants ─────────────────────────────────────
// 3D: fixed model-space offsets (legacy behaviour)
const TICK_LEN_3D   = 0.05
const LABEL_DIST_3D = 0.12
const TITLE_EXTRA_3D = 0.14   // extra outward offset for axis title beyond LABEL_DIST_3D
const TITLE_LINE_STEP_3D = 0.05  // multi-line title step in model space

// 2D axis bands sit at pixel distances outward from the axis line. Only the tick band
// is a genuinely fixed drawn line; the tick-label and title band sizes are read from
// the rendered font via the atlas (TickLabelAtlas.measure / .lineHeight / .gap) — see
// Axis.tickLabelBandPx() / titleBandPx() — never hard-coded, so the layout is correct
// at any font size instead of pinned to a line-height assumption.
export const TICK_BAND_PX = 6
export const LOCK_GLYPH = '🔒'

/**
 * An Axis represents a single data axis on a plot.
 *
 * Public interface (unchanged from before):
 *   axis.quantityKind, axis.isSpatial, axis.getDomain(), axis.setDomain(),
 *   axis.subscribe(), axis.unsubscribe()
 *
 * Rendering is now entirely WebGL-based. Call axis.render() from Plot.render().
 */
export class Axis {
  constructor(plot, name) {
    this._plot        = plot
    this._name        = name
    this._listeners   = new Set()
    this._linkedAxes  = new Set()
    this._propagating = false
  }

  get quantityKind() { return this._plot.getAxisQuantityKind(this._name) }

  // True for all 12 spatial axes; false for colour/filter axes.
  get isSpatial() { return Object.prototype.hasOwnProperty.call(AXIS_GEOMETRY, this._name) }

  getDomain() { return this._plot.getAxisDomain(this._name) }

  // setDomain(null) — or an absent domain — resets this axis to its data range,
  // resolved to concrete numbers here (never the marker), so listeners and linked axes
  // receive this axis's resolved range rather than re-resolving against their own data.
  setDomain(domain, { sourcePlot = null } = {}) {
    if (this._propagating) return
    if (domain == null) {
      domain = this._resolveDataDomain()
      if (domain == null) return   // no data extent to reset to
    }
    this._propagating = true
    try {
      this._plot.setAxisDomain(this._name, domain)
      this._plot.scheduleRender(sourcePlot)
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  // Resolve the setDomain(null) marker to this axis's data range (the data extent of
  // its quantity kind). Keeps a reversed axis reversed and a log axis above zero, as
  // auto-fit does. Returns null when there is no stored data extent.
  _resolveDataDomain() {
    const qk = this.quantityKind
    if (!qk) return null
    const ext = this._plot.axisRegistry?.getDataExtent(qk)
    if (!ext) return null
    let min = ext[0], max = ext[1]
    const cur = this.getDomain()
    if (cur && cur[0] > cur[1]) { const t = min; min = max; max = t }
    if (this._plot.axisRegistry.isLogScale?.(this._name) && min <= 0) min = Number.MIN_VALUE
    return [min, max]
  }

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }

  // ─── Atlas-derived 2D band sizes (outward px from the axis line) ─────────────

  // Tick-label band: the rendered label height for a horizontal (x) axis, the widest
  // rendered label width for a vertical (y) axis — both measured from the atlas font.
  tickLabelBandPx(atlas) {
    const scale = this._plot.axisRegistry?.getScale(this._name)
    if (!scale || !atlas) return 0
    if (AXIS_GEOMETRY[this._name].dir !== 'y') return atlas.lineHeight + atlas.gap
    let maxW = 0
    for (const t of this._computeTicks(scale, 6)) {
      const w = atlas.measure(formatTick(t)).pw
      if (w > maxW) maxW = w
    }
    return maxW + atlas.gap
  }

  // Title band: the rendered title height × its line count, measured from the atlas.
  titleBandPx(atlas) {
    if (!atlas) return 0
    const qk = this._plot.axisRegistry?.getQkForSlot(this._name)
    if (!qk) return 0
    const cfg = this._plot.currentConfig?.axes?.[this._name] ?? {}
    const label = cfg.label ?? getAxisQuantityKind(qk).label
    if (!label) return 0
    const lines = String(label).split('\n').length
    return atlas.lineHeight * lines + atlas.gap
  }

  // Outward px to the centre of the tick-label band (where label billboards anchor).
  labelAnchorPx(atlas) { return TICK_BAND_PX + this.tickLabelBandPx(atlas) / 2 }

  // Outward px where the title band starts (beyond the tick and label bands).
  titleBandStartPx(atlas) { return TICK_BAND_PX + this.tickLabelBandPx(atlas) }

  // ─── WebGL rendering ───────────────────────────────────────────────────────

  // Pre-pass: mark all labels this axis needs into the atlas (no flush).
  // Called by Plot.render() for all axes before the single atlas.flush().
  prepareAtlas(atlas, axisMvp, cw, ch) {
    if (!this.isSpatial) return
    const { axisRegistry, currentConfig } = this._plot
    const axisConfig = currentConfig?.axes?.[this._name] ?? {}
    if (axisConfig.visible === false) return
    const scale = axisRegistry.getScale(this._name)
    if (!scale) return

    if (axisConfig.tickLabelsVisible !== false) {
      const screenLen = this._projectedLength(axisMvp, cw, ch)
      const pxPerTick = AXIS_GEOMETRY[this._name].dir === 'y' ? 27 : 40
      const tickCount = Math.max(2, Math.floor(screenLen / pxPerTick))
      const ticks     = this._computeTicks(scale, tickCount)
      atlas.markLabels(ticks.map(t => formatTick(t)))
    }

    const qk = axisRegistry.getQkForSlot(this._name)
    if (qk && axisConfig.titleVisible !== false) {
      const unitLabel  = axisConfig.label ?? getAxisQuantityKind(qk).label
      if (unitLabel) {
        atlas.markLabels(String(unitLabel).split('\n'))
        if (this._plot.isAxisLocked?.(this._name)) atlas.markLabels([LOCK_GLYPH])
      }
    }
  }

  // Compute the approximate projected screen length of this axis (for tick density).
  _projectedLength(axisMvp, cw, ch) {
    const { start, end } = axisEndpoints(this._name)
    const s = projectToScreen(start, axisMvp, cw, ch)
    const e = projectToScreen(end,   axisMvp, cw, ch)
    if (!s || !e) return 0
    const dx = e[0] - s[0], dy = e[1] - s[1]
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Returns tick values as an array of numbers.
  _computeTicks(scale, count) {
    const isLog = typeof scale.base === 'function'
    if (isLog) {
      const tv = logTickValues(scale, count)
      if (tv !== null) return tv
    }
    if (count <= 2) return scale.domain()
    return scale.ticks(count)
  }

  // Returns the outward screen-space unit direction [dx, dy] (HTML coords, y down).
  _outwardScreenDir(axisMvp, cw, ch) {
    const { start, end } = axisEndpoints(this._name)
    const mid3D  = [(start[0]+end[0])/2, (start[1]+end[1])/2, (start[2]+end[2])/2]
    const ow = AXIS_GEOMETRY[this._name].outward
    const tip3D  = [mid3D[0] + ow[0]*0.2, mid3D[1] + ow[1]*0.2, mid3D[2] + ow[2]*0.2]
    const midS = projectToScreen(mid3D, axisMvp, cw, ch)
    const tipS = projectToScreen(tip3D, axisMvp, cw, ch)
    if (!midS || !tipS) return [0, 1]
    const dx = tipS[0] - midS[0], dy = tipS[1] - midS[1]
    const len = Math.sqrt(dx*dx + dy*dy)
    return len > 0.5 ? [dx/len, dy/len] : [0, 1]
  }

  // Greedy screen-space overlap rejection. Returns an array of indices into `ticks`
  // that can be rendered without their label boxes overlapping.
  _visibleTickIndices(ticks, screenPositions, tickLabelAtlas) {
    const accepted = [], boxes = []
    for (let i = 0; i < ticks.length; i++) {
      const sp = screenPositions[i]
      if (!sp) continue
      const label = formatTick(ticks[i])
      const entry = tickLabelAtlas.getEntry(label)
      const pw = entry ? entry.pw : 48, ph = entry ? entry.ph : 16
      const box = [sp[0] - pw/2, sp[1] - ph/2, sp[0] + pw/2, sp[1] + ph/2]
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue
      accepted.push(i)
      boxes.push(box)
    }
    return accepted
  }

  /**
   * Render this axis using the shared WebGL draw commands supplied by Plot.
   *
   * @param {object} regl          - regl instance
   * @param {Float32Array} axisMvp - MVP that maps model space to full-canvas NDC
   * @param {number} cw            - canvas width in pixels
   * @param {number} ch            - canvas height in pixels
   * @param {boolean} is3D         - enables depth testing (3D) vs always-on-top (2D)
   * @param {TickLabelAtlas} atlas - shared label atlas
   * @param {Function} lineCmd     - compiled regl command for axis/tick lines
   * @param {Function} billboardCmd- compiled regl command for label billboards
   */
  render(regl, axisMvp, cw, ch, is3D, atlas, lineCmd, billboardCmd, viewportOrigin = { x: 0, y: 0 }) {
    if (!this.isSpatial) return
    // Reset per-render cue diagnostics before any early return, so a whole-hidden
    // axis reports no line colour and no drawn parts.
    this._lastLineColor = null
    this._lastDrewLabels = false
    this._lastDrewTitle = false
    this._lastDrewLockGlyph = false

    const { axisRegistry, currentConfig } = this._plot
    const axisConfig = currentConfig?.axes?.[this._name] ?? {}
    if (axisConfig.visible === false) return
    const scale = axisRegistry.getScale(this._name)
    if (!scale) return

    // A locked axis draws its line red; this cue is independent of the labels and
    // the title, so it survives tickLabelsVisible/titleVisible being false.
    const locked = !!this._plot.isAxisLocked?.(this._name)

    const geom   = AXIS_GEOMETRY[this._name]
    const isLog  = typeof scale.base === 'function'
    const domain = scale.domain()
    const { start, end } = axisEndpoints(this._name)
    const ow = geom.outward   // [ox, oy, oz]

    // ── 0. Outward screen direction + model-space offset resolution ──────────
    const mid3D = [(start[0]+end[0])/2, (start[1]+end[1])/2, (start[2]+end[2])/2]
    const tip3D = [mid3D[0]+ow[0]*0.2, mid3D[1]+ow[1]*0.2, mid3D[2]+ow[2]*0.2]
    const midS  = projectToScreen(mid3D, axisMvp, cw, ch)
    const tipS  = projectToScreen(tip3D, axisMvp, cw, ch)
    const outDirVec = (midS && tipS) ? [tipS[0]-midS[0], tipS[1]-midS[1]] : [0, 1]
    const outDirLen = Math.sqrt(outDirVec[0]**2 + outDirVec[1]**2)
    const outDir    = outDirLen > 0.5 ? [outDirVec[0]/outDirLen, outDirVec[1]/outDirLen] : [0, 1]
    const pxPerModelUnit = outDirLen / 0.2

    let tickModelLen, labelModelDist, titleModelDist, titleLineStep
    if (!is3D && midS && pxPerModelUnit > 0) {
      // In 2D: place each part at a pixel distance outward from the axis line,
      // converted to model units via the axis's screen scale. The tick band is fixed;
      // the label and title bands are read from the rendered font via the atlas.
      const toModel   = (px) => px / pxPerModelUnit
      const labelBand = this.tickLabelBandPx(atlas)
      tickModelLen   = toModel(TICK_BAND_PX)
      labelModelDist = toModel(TICK_BAND_PX + labelBand / 2)
      titleModelDist = toModel(TICK_BAND_PX + labelBand + atlas.lineHeight / 2)
      titleLineStep  = toModel(atlas.lineHeight)
    } else {
      // In 3D: fixed model-space offsets (original behaviour).
      tickModelLen   = TICK_LEN_3D
      labelModelDist = LABEL_DIST_3D
      titleModelDist = LABEL_DIST_3D + TITLE_EXTRA_3D
      titleLineStep  = TITLE_LINE_STEP_3D
    }

    // ── 1. Tick count based on projected screen length ──────────────────────
    const screenLen   = this._projectedLength(axisMvp, cw, ch)
    const pxPerTick   = geom.dir === 'y' ? 27 : 40
    const tickCount   = Math.max(2, Math.floor(screenLen / pxPerTick))
    const ticks       = this._computeTicks(scale, tickCount)

    // ── 2. Build axis line + tick-mark geometry ─────────────────────────────
    // Each pair of consecutive floats = one endpoint of a line segment (primitive: 'lines').
    const lineVerts = []

    // Main axis line
    lineVerts.push(...start, ...end)

    // Tick marks
    for (const t of ticks) {
      const n = normaliseValue(t, domain, isLog)
      if (!isFinite(n)) continue
      const pos = axisPosAtN(this._name, n)
      lineVerts.push(
        pos[0],                    pos[1],                    pos[2],
        pos[0] + ow[0]*tickModelLen, pos[1] + ow[1]*tickModelLen, pos[2] + ow[2]*tickModelLen,
      )
    }

    const fullViewport = { x: viewportOrigin.x, y: viewportOrigin.y, width: cw, height: ch }

    const lineColor = locked ? [0.85, 0.10, 0.10, 1] : [0, 0, 0, 1]
    this._lastLineColor = lineColor
    lineCmd({
      positions: new Float32Array(lineVerts),
      mvp:       axisMvp,
      color:     lineColor,
      viewport:  fullViewport,
      count:     lineVerts.length / 3,
      depthEnable: is3D,
    })

    // ── 3. Tick labels ──────────────────────────────────────────────────────
    if (!atlas.texture) return
    const labels = ticks.map(t => formatTick(t))

    if (axisConfig.tickLabelsVisible !== false) {

    // Compute label anchor positions in model space and project to screen.
    const anchors3D = ticks.map((t) => {
      const n = normaliseValue(t, domain, isLog)
      if (!isFinite(n)) return null
      const pos = axisPosAtN(this._name, n)
      return [pos[0] + ow[0]*labelModelDist, pos[1] + ow[1]*labelModelDist, pos[2] + ow[2]*labelModelDist]
    })
    const screenPositions = anchors3D.map(a => a ? projectToScreen(a, axisMvp, cw, ch) : null)

    const visIdx = this._visibleTickIndices(ticks, screenPositions, atlas)

    // Build billboard vertex arrays.
    const aAnchor = [], aOffsetPx = [], aUV = []

    for (const i of visIdx) {
      const anchor3D = anchors3D[i]
      if (!anchor3D) continue
      const entry = atlas.getEntry(labels[i])
      if (!entry) continue
      const { pw, ph, u, v, uw, vh } = entry
      const hw = pw / 2, hh = ph / 2
      // 6 vertices (2 triangles): TL TR BL   TR BR BL
      const corners = [
        [-hw, -hh, u,    v   ],
        [+hw, -hh, u+uw, v   ],
        [-hw, +hh, u,    v+vh],
        [+hw, -hh, u+uw, v   ],
        [+hw, +hh, u+uw, v+vh],
        [-hw, +hh, u,    v+vh],
      ]
      for (const [ox, oy, tu, tv] of corners) {
        aAnchor.push(...anchor3D)
        aOffsetPx.push(ox, oy)
        aUV.push(tu, tv)
      }
    }

    if (aAnchor.length > 0) {
      billboardCmd({
        anchors:    new Float32Array(aAnchor),
        offsetsPx:  new Float32Array(aOffsetPx),
        uvs:        new Float32Array(aUV),
        mvp:        axisMvp,
        canvasSize: [cw, ch],
        atlas:      atlas.texture,
        viewport:   fullViewport,
        count:      aAnchor.length / 3,
        depthEnable: is3D,
      })
      this._lastDrewLabels = true
    }
    } // end tickLabelsVisible

    // ── 4. Axis title ───────────────────────────────────────────────────────
    const qk        = axisRegistry.getQkForSlot(this._name)
    if (!qk) return
    if (axisConfig.titleVisible === false) return
    const unitLabel  = axisConfig.label ?? getAxisQuantityKind(qk).label
    if (!unitLabel) return

    const titleLines = String(unitLabel).split('\n')

    // Place title at axis midpoint + larger outward offset
    const titleAnchorBase = [
      mid3D[0] + ow[0] * titleModelDist,
      mid3D[1] + ow[1] * titleModelDist,
      mid3D[2] + ow[2] * titleModelDist,
    ]

    // Rotate the title 90° CW when the axis is more vertical than horizontal in
    // screen space (works for 2D and 3D). Rotation: (ox, oy) → (oy, -ox).
    const sStart = projectToScreen(start, axisMvp, cw, ch)
    const sEnd   = projectToScreen(end,   axisMvp, cw, ch)
    const axisDx = sEnd && sStart ? sEnd[0] - sStart[0] : 0
    const axisDy = sEnd && sStart ? sEnd[1] - sStart[1] : 0
    const isVertical = Math.abs(axisDy) > Math.abs(axisDx)
    const rotate = ([ox, oy, tu, tv]) => isVertical ? [oy, -ox, tu, tv] : [ox, oy, tu, tv]

    const titleAnchor = [], titleOffsets = [], titleUVs = []
    let lineOffset = 0
    let firstLineHw = 0   // half-width of line 0, to place the lock glyph at its end
    for (let li = 0; li < titleLines.length; li++) {
      const entry = atlas.getEntry(titleLines[li])
      if (!entry) continue
      const { pw, ph, u, v, uw, vh } = entry
      const hw = pw / 2, hh = ph / 2
      if (li === 0) firstLineHw = hw
      // Shift successive lines along the outward screen direction
      const anchor3D = [
        titleAnchorBase[0] + ow[0]*lineOffset,
        titleAnchorBase[1] + ow[1]*lineOffset,
        titleAnchorBase[2] + ow[2]*lineOffset,
      ]
      const corners = [
        [-hw, -hh, u,    v   ],
        [+hw, -hh, u+uw, v   ],
        [-hw, +hh, u,    v+vh],
        [+hw, -hh, u+uw, v   ],
        [+hw, +hh, u+uw, v+vh],
        [-hw, +hh, u,    v+vh],
      ].map(rotate)
      for (const [ox, oy, tu, tv] of corners) {
        titleAnchor.push(...anchor3D)
        titleOffsets.push(ox, oy)
        titleUVs.push(tu, tv)
      }
      lineOffset += titleLineStep  // shift next line further out in model space
    }

    if (titleAnchor.length > 0) {
      billboardCmd({
        anchors:    new Float32Array(titleAnchor),
        offsetsPx:  new Float32Array(titleOffsets),
        uvs:        new Float32Array(titleUVs),
        mvp:        axisMvp,
        canvasSize: [cw, ch],
        atlas:      atlas.texture,
        viewport:   fullViewport,
        count:      titleAnchor.length / 3,
        depthEnable: is3D,
      })
      this._lastDrewTitle = true
    }

    // ── 5. Lock glyph ─────────────────────────────────────────────────────────
    // A small glyph at the end of the title text, on the same line (same outward
    // distance as the title, shifted along the text direction past its last glyph).
    // Drawn only where the title is drawn. Purely visual — it reflects the lock, it
    // does not set it (the red line is the cue that always shows).
    if (locked) {
      const entry = atlas.getEntry(LOCK_GLYPH)
      if (entry) {
        const { pw, ph, u, v, uw, vh } = entry
        const hw = pw / 2, hh = ph / 2
        // Centre the glyph just past the end of the first title line, in the text's
        // reading direction (local +ox), then share the title's rotation + anchor.
        const endX = firstLineHw + atlas.gap + hw
        const corners = [
          [endX - hw, -hh, u,    v   ],
          [endX + hw, -hh, u+uw, v   ],
          [endX - hw, +hh, u,    v+vh],
          [endX + hw, -hh, u+uw, v   ],
          [endX + hw, +hh, u+uw, v+vh],
          [endX - hw, +hh, u,    v+vh],
        ].map(rotate)
        const gA = [], gO = [], gU = []
        for (const [ox, oy, tu, tv] of corners) { gA.push(...titleAnchorBase); gO.push(ox, oy); gU.push(tu, tv) }
        billboardCmd({
          anchors:    new Float32Array(gA),
          offsetsPx:  new Float32Array(gO),
          uvs:        new Float32Array(gU),
          mvp:        axisMvp,
          canvasSize: [cw, ch],
          atlas:      atlas.texture,
          viewport:   fullViewport,
          count:      gA.length / 3,
          depthEnable: is3D,
        })
        this._lastDrewLockGlyph = true
      }
    }
  }

  // ─── Per-axis config / schema accessors (counterparts of the Plot methods) ───

  // The merged per-slot config for this axis — identical to
  // plot.getConfig().axes[slot] (the governing round-trip invariant), not the raw
  // currentConfig.axes[slot] override slice.
  getConfig() {
    const plot = this._plot
    if (plot._axisConfig && plot.axisRegistry?.getScale?.(this._name)) {
      return plot._axisConfig(this._name)
    }
    return plot.getConfig?.().axes?.[this._name] ?? { ...(plot.currentConfig?.axes?.[this._name] ?? {}) }
  }

  // Writes cfg as this axis's axes.<slot> object and re-applies through the plot's
  // normal config path, so every key takes effect.
  async setConfig(cfg) {
    const plot = this._plot
    const config = plot.currentConfig ?? {}
    const axes = { ...(config.axes ?? {}), [this._name]: cfg }
    await plot.update({ config: { ...config, axes } })
  }

  // The JSON Schema fragment governing one axis config — the same for every axis,
  // so it is static and takes no arguments (mirrors the static Plot.schema()).
  static schema() {
    return Plot.schema().properties.axes.additionalProperties
  }
}
