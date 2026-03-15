import { AXIS_GEOMETRY, axisEndpoints, axisPosAtN } from "./AxisRegistry.js"
import { getAxisQuantityKind } from "./AxisQuantityKindRegistry.js"
import { projectToScreen } from "../math/mat4.js"

// ─── Tick formatting (same logic as before) ───────────────────────────────────

function formatTick(v) {
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

// ─── Tick mark / label geometry constants (model-space units) ─────────────────
const TICK_LEN   = 0.05   // tick line length along outward direction
const LABEL_DIST = 0.12   // label anchor distance from axis surface

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

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }

  // ─── WebGL rendering ───────────────────────────────────────────────────────

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
  render(regl, axisMvp, cw, ch, is3D, atlas, lineCmd, billboardCmd) {
    if (!this.isSpatial) return
    const { axisRegistry, currentConfig } = this._plot
    const scale = axisRegistry.getScale(this._name)
    if (!scale) return

    const geom   = AXIS_GEOMETRY[this._name]
    const isLog  = typeof scale.base === 'function'
    const domain = scale.domain()
    const { start, end } = axisEndpoints(this._name)
    const ow = geom.outward   // [ox, oy, oz]

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
        pos[0],              pos[1],              pos[2],
        pos[0] + ow[0]*TICK_LEN, pos[1] + ow[1]*TICK_LEN, pos[2] + ow[2]*TICK_LEN,
      )
    }

    const fullViewport = { x: 0, y: 0, width: cw, height: ch }

    lineCmd({
      positions: new Float32Array(lineVerts),
      mvp:       axisMvp,
      color:     [0, 0, 0, 1],
      viewport:  fullViewport,
      count:     lineVerts.length / 3,
      depthEnable: is3D,
    })

    // ── 3. Tick labels ──────────────────────────────────────────────────────
    const labels = ticks.map(t => formatTick(t))
    atlas.markLabels(labels)
    atlas.flush()

    if (!atlas.texture) return

    // Compute label anchor positions in model space and project to screen.
    const anchors3D = ticks.map((t) => {
      const n = normaliseValue(t, domain, isLog)
      if (!isFinite(n)) return null
      const pos = axisPosAtN(this._name, n)
      return [pos[0] + ow[0]*LABEL_DIST, pos[1] + ow[1]*LABEL_DIST, pos[2] + ow[2]*LABEL_DIST]
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
    }

    // ── 4. Axis title ───────────────────────────────────────────────────────
    const qk        = axisRegistry.axisQuantityKinds[this._name]
    if (!qk) return
    const axisConfig = currentConfig?.axes?.[this._name] ?? {}
    const unitLabel  = axisConfig.label ?? getAxisQuantityKind(qk).label
    if (!unitLabel) return

    const titleLines = String(unitLabel).split('\n')
    for (const line of titleLines) atlas.markLabels([line])
    atlas.flush()

    // Place title at axis midpoint + larger outward offset
    const mid3D = [(start[0]+end[0])/2, (start[1]+end[1])/2, (start[2]+end[2])/2]
    const titleAnchorBase = [
      mid3D[0] + ow[0] * (LABEL_DIST + 0.14),
      mid3D[1] + ow[1] * (LABEL_DIST + 0.14),
      mid3D[2] + ow[2] * (LABEL_DIST + 0.14),
    ]

    const titleAnchor = [], titleOffsets = [], titleUVs = []
    let lineOffset = 0
    for (const line of titleLines) {
      const entry = atlas.getEntry(line)
      if (!entry) continue
      const { pw, ph, u, v, uw, vh } = entry
      const hw = pw / 2, hh = ph / 2
      // Shift successive lines along the outward screen direction
      const anchor3D = [
        titleAnchorBase[0] + ow[0]*lineOffset,
        titleAnchorBase[1] + ow[1]*lineOffset,
        titleAnchorBase[2] + ow[2]*lineOffset,
      ]
      const rawCorners = [
        [-hw, -hh, u,    v   ],
        [+hw, -hh, u+uw, v   ],
        [-hw, +hh, u,    v+vh],
        [+hw, -hh, u+uw, v   ],
        [+hw, +hh, u+uw, v+vh],
        [-hw, +hh, u,    v+vh],
      ]
      // Rotate the title 90° CW when the axis is more vertical than horizontal
      // in screen space (works for 2D and 3D).  Rotation: (ox, oy) → (oy, -ox)
      const sStart = projectToScreen(start, axisMvp, cw, ch)
      const sEnd   = projectToScreen(end,   axisMvp, cw, ch)
      const axisDx = sEnd ? sEnd[0] - sStart[0] : 0
      const axisDy = sEnd ? sEnd[1] - sStart[1] : 0
      const isVertical = Math.abs(axisDy) > Math.abs(axisDx)
      const corners = isVertical
        ? rawCorners.map(([ox, oy, tu, tv]) => [oy, -ox, tu, tv])
        : rawCorners
      for (const [ox, oy, tu, tv] of corners) {
        titleAnchor.push(...anchor3D)
        titleOffsets.push(ox, oy)
        titleUVs.push(tu, tv)
      }
      lineOffset += 0.05  // shift next line further out in model space
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
    }
  }
}
