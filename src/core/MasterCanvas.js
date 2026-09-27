import { initRegl } from './initRegl.js'
import { FramebufferRegistry } from './FramebufferRegistry.js'

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

// The single shared regl context lives on an OffscreenCanvas. Each Plot owns a real
// on-screen <canvas> with a 'bitmaprenderer' context; per frame, every dirty plot is
// rendered into the shared offscreen at origin and handed to its display canvas via
// transferToImageBitmap() → transferFromImageBitmap() (a GPU-side handle move, no CPU
// readback). Because every plot is a normal DOM layer again, the browser composites
// z-index, border-radius, alpha and shadows for free — no hole-punching.
class MasterCanvas {
  constructor() {
    this._offscreen = new OffscreenCanvas(1, 1)
    this.regl = initRegl(this._offscreen)

    this.axisLineCmd      = buildAxisLineCmd(this.regl)
    this.axisBillboardCmd = buildAxisBillboardCmd(this.regl)

    this.fboRegistry = new FramebufferRegistry()

    this._plots      = new Set()
    this._dirtyPlots = new Set()
    this._rafId      = null
    this._ticking    = false

    // A window resize can change DPR; per-plot sizing is handled by each plot's
    // ResizeObserver, so here we just reschedule every plot.
    this._resizeHandler = () => {
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

    // Phase 1 — async: refresh transforms and data columns for dirty plots only,
    // in parallel. Done outside any draw so tdrYield() calls don't interfere.
    await Promise.all([...dirty].map(p =>
      p._prepareRender().catch(e => console.error('[gladly] _prepareRender:', e))
    ))

    // Phase 2 — sync: render each dirty plot into the shared offscreen and transfer
    // the resulting bitmap to that plot's display canvas. Non-dirty plots keep their
    // existing bitmap and the browser keeps compositing them.
    for (const plot of dirty) {
      const rect = plot._canvas.getBoundingClientRect()
      if (!this._isVisible(rect)) continue
      plot._updateDimensions(rect)
      const w = plot.width, h = plot.height
      if (this._offscreen.width  !== w) this._offscreen.width  = w   // resize only on change
      if (this._offscreen.height !== h) this._offscreen.height = h
      this.regl.poll()
      try {
        plot._drawSync()                                   // draws at origin into the offscreen
      } catch (e) {
        console.error('[gladly] _drawSync:', e)
        continue
      }
      plot._displayCtx.transferFromImageBitmap(this._offscreen.transferToImageBitmap())
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
