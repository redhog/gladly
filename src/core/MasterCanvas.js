import { initRegl } from './initRegl.js'
import { FramebufferRegistry } from './FramebufferRegistry.js'

// Returns the effective CSS z-order of an element by walking up its ancestor chain
// and returning the first explicit numeric z-index found.
// Elements with display:none anywhere in their ancestry have width/height 0 from
// getBoundingClientRect() and are excluded from the plot list before this is called.
function _getEffectiveZOrder(el) {
  let node = el
  while (node && node !== document.documentElement) {
    const z = parseInt(getComputedStyle(node).zIndex, 10)
    if (!isNaN(z)) return z
    node = node.parentElement
  }
  return 0
}

// Returns the sub-rects of `outer` that are not covered by `inner`.
// At most 4 axis-aligned rectangles (left/right/bottom/top strips around the overlap).
function _subtractRect(outer, inner) {
  const ox2 = outer.x + outer.width,  oy2 = outer.y + outer.height
  const ix1 = Math.max(outer.x, inner.x), iy1 = Math.max(outer.y, inner.y)
  const ix2 = Math.min(ox2, inner.x + inner.width), iy2 = Math.min(oy2, inner.y + inner.height)
  if (ix1 >= ix2 || iy1 >= iy2) return [outer]  // no overlap
  const rects = []
  if (outer.x < ix1) rects.push({ x: outer.x, y: outer.y, width: ix1 - outer.x,       height: oy2 - outer.y })
  if (ix2 < ox2)     rects.push({ x: ix2,      y: outer.y, width: ox2 - ix2,            height: oy2 - outer.y })
  if (outer.y < iy1) rects.push({ x: ix1,      y: outer.y, width: ix2 - ix1,            height: iy1 - outer.y })
  if (iy2 < oy2)     rects.push({ x: ix1,      y: iy2,     width: ix2 - ix1,            height: oy2 - iy2     })
  return rects
}

// Returns scissor-space rects for every DOM element that visually appears on top of
// plot._placeholder, determined purely by the browser's own paint order.
// Works by sampling a grid of points within the placeholder, calling
// document.elementsFromPoint() at each, and collecting every element that appears
// *before* the placeholder in the returned list (i.e. is painted on top of it).
// This handles floats, their borders/drag-bars, checkboxes, modals — anything.
function _getDocumentOverlays(plot) {
  const ph = plot._placeholder
  const r  = ph.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return []

  const seen  = new Set()
  const rects = []
  const COLS  = 4, ROWS = 4

  for (let c = 0; c < COLS; c++) {
    for (let row = 0; row < ROWS; row++) {
      const x = r.left + (c + 0.5) * r.width  / COLS
      const y = r.top  + (row + 0.5) * r.height / ROWS
      const elems = document.elementsFromPoint(x, y)
      const idx = elems.indexOf(ph)
      if (idx <= 0) continue  // placeholder is topmost at this point — no overlays
      for (let i = 0; i < idx; i++) {
        const el = elems[i]
        if (seen.has(el)) continue
        seen.add(el)
        const er = el.getBoundingClientRect()
        if (er.width <= 0 || er.height <= 0) continue
        rects.push({
          x:      Math.round(er.left),
          y:      Math.round(window.innerHeight - er.bottom),
          width:  Math.max(1, Math.round(er.width)),
          height: Math.max(1, Math.round(er.height)),
        })
      }
    }
  }
  return rects
}

function buildAxisLineCmd(regl) {
  return regl({
    vert: `#version 300 es
precision highp float;
in vec3 a_position;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_position, 1.0); }`,
    frag: `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`,
    attributes: { a_position: regl.prop('positions') },
    uniforms: {
      u_mvp:   regl.prop('mvp'),
      u_color: regl.prop('color'),
    },
    primitive: 'lines',
    count:     regl.prop('count'),
    viewport:  regl.prop('viewport'),
    depth: { enable: regl.prop('depthEnable'), mask: true },
  })
}

function buildAxisBillboardCmd(regl) {
  return regl({
    vert: `#version 300 es
precision highp float;
in vec3 a_anchor;
in vec2 a_offset_px;
in vec2 a_uv;
uniform mat4 u_mvp;
uniform vec2 u_canvas_size;
out vec2 v_uv;
void main() {
  vec4 clip = u_mvp * vec4(a_anchor, 1.0);
  vec2 ndc_anchor = clip.xy / clip.w;
  vec2 anchor_px  = vec2(
     ndc_anchor.x * 0.5 + 0.5,
    -ndc_anchor.y * 0.5 + 0.5) * u_canvas_size;
  vec2 hw_vec  = abs(a_offset_px);
  vec2 tl_px   = floor(anchor_px - hw_vec);
  vec2 vert_px = tl_px + hw_vec + a_offset_px;
  vec2 ndc = vec2(
     vert_px.x / u_canvas_size.x * 2.0 - 1.0,
    -(vert_px.y / u_canvas_size.y * 2.0 - 1.0));
  gl_Position = vec4(ndc, clip.z / clip.w, 1.0);
  v_uv = a_uv;
}`,
    frag: `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 tc = ivec2(v_uv * vec2(textureSize(u_atlas, 0)));
  fragColor = texelFetch(u_atlas, tc, 0);
  if (fragColor.a < 0.05) discard;
}`,
    attributes: {
      a_anchor:    regl.prop('anchors'),
      a_offset_px: regl.prop('offsetsPx'),
      a_uv:        regl.prop('uvs'),
    },
    uniforms: {
      u_mvp:         regl.prop('mvp'),
      u_canvas_size: regl.prop('canvasSize'),
      u_atlas:       regl.prop('atlas'),
    },
    primitive: 'triangles',
    count:     regl.prop('count'),
    viewport:  regl.prop('viewport'),
    depth: { enable: regl.prop('depthEnable'), mask: false },
    blend: {
      enable: true,
      func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 },
    },
  })
}

class MasterCanvas {
  constructor() {
    this._canvas = document.createElement('canvas')
    // z-index:1000 puts the canvas above all DOM content (floats, overlays).
    // pointer-events:none lets clicks fall through to DOM elements below.
    this._canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1000;'
    document.body.appendChild(this._canvas)

    this._canvas.width  = window.innerWidth
    this._canvas.height = window.innerHeight

    this.regl = initRegl(this._canvas)

    this.axisLineCmd      = buildAxisLineCmd(this.regl)
    this.axisBillboardCmd = buildAxisBillboardCmd(this.regl)

    this.fboRegistry = new FramebufferRegistry()

    this._plots      = new Set()
    this._dirtyPlots = new Set()
    this._rafId      = null
    this._ticking    = false

    this._resizeHandler = () => {
      this._canvas.width  = window.innerWidth
      this._canvas.height = window.innerHeight
      this.regl.poll()
      for (const plot of this._plots) plot.scheduleRender()
    }
    window.addEventListener('resize', this._resizeHandler)
  }

  register(plot) {
    this._plots.add(plot)
  }

  unregister(plot) {
    this._plots.delete(plot)
    this._dirtyPlots.delete(plot)
    if (this._plots.size === 0 && this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  schedulePlotRender(plot) {
    this._dirtyPlots.add(plot)
    this._scheduleRAF()
  }

  _scheduleRAF() {
    if (this._rafId !== null || this._ticking) return
    this._rafId = requestAnimationFrame(t => this._tick(t))
  }

  _plotScissor(rect) {
    return {
      x:      Math.round(rect.left),
      y:      Math.round(window.innerHeight - rect.bottom),
      width:  Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
  }

  _isVisible(rect) {
    // getBoundingClientRect() returns a zero-size rect when the element or any
    // ancestor has display:none — that naturally excludes hidden plots.
    return (
      rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top    < window.innerHeight &&
      rect.right  > 0 && rect.left   < window.innerWidth
    )
  }

  async _tick(rafTime) {
    this._rafId = null
    this._ticking = true
    const dirty = new Set(this._dirtyPlots)
    this._dirtyPlots.clear()

    // Phase 1 — async: refresh transforms and data columns for dirty plots only.
    // Done outside any scissor scope so tdrYield() calls don't interfere with draws.
    await Promise.all([...dirty].map(p =>
      p._prepareRender().catch(e => console.error('[gladly] _prepareRender:', e))
    ))

    // Phase 2 — sync: draw ALL visible plots in zOrder (back-to-front).
    // For each plot we compute its "owned" sub-rects — its full bounding box minus any
    // higher-z overlapping plots — so every canvas pixel belongs to exactly one plot.
    // _drawSync handles the per-sub-rect scissored clear + draw internally.
    this.regl.poll()

    // Clear the entire canvas to transparent so areas outside any plot's owned
    // sub-rects are see-through, and stale content from moved floats is wiped.
    // Each plot's _drawSync then clears its own sub-rects to opaque white.
    this.regl.clear({ color: [0, 0, 0, 0], depth: 1 })

    // Collect visible boxes and sort back-to-front by zOrder.
    const plotBoxes = []
    for (const plot of this._plots) {
      const rect = plot._placeholder.getBoundingClientRect()
      if (!this._isVisible(rect)) continue
      const box = this._plotScissor(rect)
      plot._updateDimensions(rect)
      plotBoxes.push({ plot, box })
    }
    // Sort back-to-front: lower CSS z-index first; break ties by DOM order
    // (earlier in document = rendered below later siblings at the same z-index).
    plotBoxes.sort((a, b) => {
      const za = _getEffectiveZOrder(a.plot._placeholder)
      const zb = _getEffectiveZOrder(b.plot._placeholder)
      if (za !== zb) return za - zb
      const pos = a.plot._placeholder.compareDocumentPosition(b.plot._placeholder)
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1
    })

    for (let i = 0; i < plotBoxes.length; i++) {
      const { plot, box } = plotBoxes[i]
      // Subtract all higher-z registered plots first (exact, no sampling needed).
      let ownedRects = [box]
      for (let j = i + 1; j < plotBoxes.length; j++) {
        ownedRects = ownedRects.flatMap(r => _subtractRect(r, plotBoxes[j].box))
      }
      // Subtract any DOM element painted on top of this plot's placeholder —
      // float borders, drag bars, checkboxes, modals, anything.
      for (const or of _getDocumentOverlays(plot)) {
        ownedRects = ownedRects.flatMap(r => _subtractRect(r, or))
      }
      plot._drawSync(box, ownedRects)
    }

    // Second RAF: gate new dirty marks until the compositor has had one GPU cycle.
    this._ticking = false
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      if (this._dirtyPlots.size > 0) this._scheduleRAF()
    })
  }
}

let _instance = null

export function getMasterCanvas() {
  if (!_instance) _instance = new MasterCanvas()
  return _instance
}
