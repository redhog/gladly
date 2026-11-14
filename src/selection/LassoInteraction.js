// Shapes a selection can be drawn with. Each one ends in plot.selectLasso(vertices), so the
// selection pipeline sees every shape as a polygon in canvas pixels.
export const LASSO_MODES = ['lasso', 'rectangle', 'triangle', 'polygon', 'circle', 'ellipse', 'band']

// Drawn by one trigger drag; the others are placed click by click.
const DRAG_MODES = ['lasso', 'rectangle', 'triangle', 'circle', 'band']

const MIN_PX = 5         // the lasso's vertex step; a shape flatter than this selects nothing
const RING_POINTS = 64   // vertices in a circle or ellipse
const BAND_REACH = 100   // a band's top and bottom sit this many plot heights past the edges

function checkMode(mode) {
  if (!LASSO_MODES.includes(mode))
    throw new Error(`Unknown lasso mode '${mode}'; expected one of ${LASSO_MODES.join(', ')}`)
}

function ring(cx, cy, a, b, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const pts = []
  for (let i = 0; i < RING_POINTS; i++) {
    const t = (2 * Math.PI * i) / RING_POINTS
    const u = a * Math.cos(t), v = b * Math.sin(t)
    pts.push([cx + u * cos - v * sin, cy + u * sin + v * cos])
  }
  return pts
}

export class LassoInteraction {
  constructor(plot, { selectionName, mode = 'lasso', trigger = 'shift', bandWidth = null } = {}) {
    checkMode(mode)
    this._plot = plot
    this._selectionName = selectionName
    this._mode = mode
    this._trigger = trigger
    this._bandWidth = bandWidth

    this._vertices = []   // the outline drawn each frame
    this._start = null    // press point of a drag shape in progress
    this._points = []     // corners or center placed so far by a click shape in progress
    this._pointer = null  // last pointer position over the canvas

    this._regl = null
    this._vertexBuf = null
    this._drawCmd = null

    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp   = this._onMouseUp.bind(this)
    this._onKey       = this._onKey.bind(this)
    this._onWheel     = this._onWheel.bind(this)

    this._renderCb = () => {
      if (this._vertices.length < 2) return
      this._ensureGl()
      if (!this._drawCmd) return
      this._vertexBuf(new Float32Array(this._vertices.flat()))
      this._drawCmd({ count: this._vertices.length, size: [plot.width, plot.height] })
    }
    plot._renderCallbacks.add(this._renderCb)

    plot._canvas.addEventListener('mousedown', this._onMouseDown)
    plot._canvas.addEventListener('wheel', this._onWheel)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
    window.addEventListener('keydown', this._onKey)
    window.addEventListener('keyup', this._onKey)
  }

  get mode() { return this._mode }
  get bandWidth() { return this._bandWidth }

  // Change the shape, abandoning one in progress.
  setMode(mode) {
    checkMode(mode)
    this._abandon()
    this._mode = mode
  }

  // Band width in the x axis's data units, used by a band click.
  setBandWidth(bandWidth) {
    this._bandWidth = bandWidth
  }

  _ensureGl() {
    const regl = this._plot.regl
    if (!regl || this._regl === regl) return
    this._regl = regl
    this._vertexBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: 0 })
    this._drawCmd = regl({
      vert: `#version 300 es
in vec2 a_pos;
uniform vec2 u_size;
void main() {
  vec2 ndc = (a_pos / u_size) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`,
      frag: `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.47, 1.0, 1.0); }`,
      attributes: { a_pos: this._vertexBuf },
      uniforms: {
        u_size: regl.prop('size'),
      },
      primitive: 'line loop',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: false },
    })
  }

  _shouldActivate(e) {
    if (this._trigger === 'shift') return e.shiftKey
    if (this._trigger === 'ctrl')  return e.ctrlKey || e.metaKey
    return true
  }

  _canvasPos(e) {
    const r = this._plot._canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  _overCanvas([x, y]) {
    return x >= 0 && y >= 0 && x <= this._plot.width && y <= this._plot.height
  }

  _setOutline(vertices) {
    this._vertices = vertices
    this._plot.scheduleRender()
  }

  _abandon() {
    this._start = null
    this._points = []
    this._setOutline([])
  }

  async _select(vertices) {
    this._abandon()
    if (vertices && vertices.length >= 3) await this._plot.selectLasso(vertices)
  }

  // ── Shapes, in canvas pixels ────────────────────────────────────────────────

  _rectangle([x0, y0], [x1, y1]) {
    if (Math.abs(x1 - x0) < MIN_PX || Math.abs(y1 - y0) < MIN_PX) return null
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  }

  // Apex, the dragged corner, and that corner mirrored across the apex's vertical.
  _triangle([ax, ay], [x, y]) {
    if (Math.abs(x - ax) < MIN_PX || Math.abs(y - ay) < MIN_PX) return null
    return [[ax, ay], [x, y], [2 * ax - x, y]]
  }

  _circle([cx, cy], [x, y]) {
    const r = Math.hypot(x - cx, y - cy)
    return r < MIN_PX ? null : ring(cx, cy, r, r, 0)
  }

  // The second semi-axis is the pointer's distance from the first axis's line.
  _ellipse([cx, cy], [x1, y1], [x, y]) {
    const a = Math.hypot(x1 - cx, y1 - cy)
    if (a < MIN_PX) return null
    const angle = Math.atan2(y1 - cy, x1 - cx)
    const b = Math.abs((x - cx) * Math.sin(angle) - (y - cy) * Math.cos(angle))
    return b < MIN_PX ? null : ring(cx, cy, a, b, angle)
  }

  _strip(xa, xb) {
    const reach = BAND_REACH * this._plot.height
    return [[xa, -reach], [xb, -reach], [xb, this._plot.height + reach], [xa, this._plot.height + reach]]
  }

  _hstrip(ya, yb) {
    const reach = BAND_REACH * this._plot.width
    return [[-reach, ya], [this._plot.width + reach, ya], [this._plot.width + reach, yb], [-reach, yb]]
  }

  // A strip bandWidth wide (x data units) centered on canvas x, through the x axis.
  _bandAt(x) {
    const scale = this._plot.axisRegistry?.getScale('xaxis_bottom') ?? this._plot.axisRegistry?.getScale('xaxis_top')
    if (!scale || !(this._bandWidth > 0)) return null
    const left = this._plot.margin.left
    const center = scale.invert(x - left)
    const xa = left + scale(center - this._bandWidth / 2)
    const xb = left + scale(center + this._bandWidth / 2)
    if (!Number.isFinite(xa) || !Number.isFinite(xb)) return null
    return this._strip(xa, xb)
  }

  _dragShape(end) {
    const start = this._start
    switch (this._mode) {
      case 'rectangle': return this._rectangle(start, end)
      case 'triangle':  return this._triangle(start, end)
      case 'circle':    return this._circle(start, end)
      // The drag's longer axis sets the band's orientation: mostly-horizontal → a vertical
      // strip, mostly-vertical → a horizontal one. A drag too short either way falls back to
      // the set-width band at the press point.
      case 'band': {
        const dx = Math.abs(end[0] - start[0]), dy = Math.abs(end[1] - start[1])
        if (dx < MIN_PX && dy < MIN_PX) return this._bandAt(start[0])
        return dx >= dy ? this._strip(start[0], end[0]) : this._hstrip(start[1], end[1])
      }
    }
  }

  // Outline of a click shape in progress, with the pointer as the next point.
  _clickOutline(pointer) {
    const pts = this._points
    if (this._mode === 'polygon') return [...pts, pointer]
    if (pts.length === 1) return [pts[0], pointer]
    return this._ellipse(pts[0], pts[1], pointer) ?? [pts[0], pts[1]]
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  _onMouseDown(e) {
    const pos = this._canvasPos(e)
    const clickMode = !DRAG_MODES.includes(this._mode)

    if (e.button === 2) {
      if (this._mode === 'polygon' && this._points.length > 0) {
        // Mark the press so ZoomController's mouseup does not read it as a 'contextmenu'.
        this._plot._rightPressConsumed = true
        this._select(this._points)
      }
      return
    }
    if (e.button !== 0) return

    if (!this._shouldActivate(e)) {
      if (this._points.length > 0) this._abandon()
      return
    }
    e.preventDefault()

    if (!clickMode) {
      this._start = pos
      this._setOutline(this._mode === 'lasso' ? [pos] : [])
      return
    }

    this._points.push(pos)
    if (this._mode === 'ellipse' && this._points.length === 3) {
      const [c, p1, p2] = this._points
      this._select(this._ellipse(c, p1, p2))
      return
    }
    this._setOutline(this._clickOutline(pos))
  }

  _onMouseMove(e) {
    const pos = this._canvasPos(e)
    this._pointer = pos

    if (this._start) {
      if (this._mode === 'lasso') {
        const last = this._vertices[this._vertices.length - 1]
        const dx = pos[0] - last[0], dy = pos[1] - last[1]
        if (dx * dx + dy * dy > MIN_PX * MIN_PX) this._setOutline([...this._vertices, pos])
      } else {
        this._setOutline(this._dragShape(pos) ?? [])
      }
      return
    }
    if (this._points.length > 0) {
      this._setOutline(this._clickOutline(pos))
      return
    }
    if (this._mode === 'band') this._previewBand(this._shouldActivate(e))
  }

  async _onMouseUp(e) {
    if (!this._start) return
    const vertices = this._mode === 'lasso' ? this._vertices : this._dragShape(this._canvasPos(e))
    await this._select(vertices)
  }

  _onKey(e) {
    if (e.type === 'keydown' && e.key === 'Escape' && (this._start || this._points.length > 0)) {
      this._abandon()
      return
    }
    // Enter closes a polygon in progress — a second way beside the right-click, whichever
    // modifier is held, so the corners and the close need not all be done with Shift down.
    if (e.type === 'keydown' && e.key === 'Enter' && this._mode === 'polygon' && this._points.length > 0) {
      this._select(this._points)
      return
    }
    if (this._mode === 'band' && !this._start) this._previewBand(this._shouldActivate(e))
  }

  _onWheel() {
    if (this._points.length > 0) this._abandon()
  }

  // While the trigger is held over the plot, show where a band click would cut.
  _previewBand(triggerHeld) {
    const show = triggerHeld && this._pointer && this._overCanvas(this._pointer)
    const outline = show ? (this._bandAt(this._pointer[0]) ?? []) : []
    if (outline.length || this._vertices.length) this._setOutline(outline)
  }

  destroy() {
    this._plot._renderCallbacks.delete(this._renderCb)
    if (this._vertexBuf) this._vertexBuf.destroy()
    this._plot._canvas.removeEventListener('mousedown', this._onMouseDown)
    this._plot._canvas.removeEventListener('wheel', this._onWheel)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    window.removeEventListener('keydown', this._onKey)
    window.removeEventListener('keyup', this._onKey)
  }
}
