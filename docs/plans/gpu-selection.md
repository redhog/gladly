# GPU-Driven Lasso Selection — Transform Feedback Plan

## Overview

Lasso selection produces a **`SelectionColumn`** (a `TextureColumn` of 0/1 floats, 4-packed, length N) tied to a specific dataset. The selection is a first-class data channel: once computed it can drive color or filter declaratively.

Multiple named selections can exist simultaneously (e.g. `"groupA"`, `"groupB"`). Each selection is tied to a specific raw dataset by object identity. Two layers in different plots automatically share a selection if and only if they declare the same selection name **and** their plots were given the same JS data object (mirroring how `AxisLink` works).

Transformed layers (histograms, KDE, FFT) have a different N from the raw data and cannot be directly selected. They consume a `SelectionColumn` as a computation input instead.

---

## Why the current halving-loop approach is wrong

The current `SelectionPipeline` renders into a pick FBO and reads pixels. Any pixel-space approach can only recover the **frontmost primitive** at each pixel. For dense scatter plots with thousands of overlapping points at the same screen location, the vast majority are unreachable no matter how many halving passes are run.

---

## The Two-Pass Algorithm

Both passes work entirely in **data space** — no depth buffer, no occlusion. All N primitives are processed in a fixed two passes regardless of how many overlap on screen.

### Pass 1 — Position Capture ("the transform in transform feedback")

Run the **exact same vertex shader** used for normal rendering, but in capture mode (`u_mode = MODE_CAPTURE`). Instead of drawing geometry, each vertex shader invocation scatter-writes its computed **NDC screen position** and **pick ID** into a float RGBA position texture, one texel per primitive.

```
Data attributes → [same vertex shader, same axis/zoom/pan transform] → Position FBO
                                                                         texel i = (ndcX, ndcY, pickId, endPoint)
```

For layer types using instanced rendering (e.g. `LinesLayer`: 2 vertices per segment, `a_endPoint ∈ {0,1}`), Pass 1 runs **twice** — once with `u_capture_endpoint = 0.0`, once with `u_capture_endpoint = 1.0` — producing two position FBOs: one for segment starts, one for ends.

### Pass 2 — Selection Test ("the feedback")

Draw `numPrimitives` instances (one `gl.POINTS` per primitive). Each instance uses `gl_InstanceID` to read its primitive's screen position(s) from the Pass 1 FBO(s) via `texelFetch`. It then tests the primitive against the lasso polygon (supplied as a `uniform vec2 u_lasso[256]`) and, if selected, scatter-writes `1.0` into the correct texel and channel of the `SelectionColumn` FBO.

```
Position FBO(s) + Lasso polygon → [per-primitive intersection test, instanced] → SelectionColumn FBO
```

Because neither pass uses a depth buffer, every primitive is processed exactly once regardless of overlap.

---

## Intersection Tests (GLSL, shared across layer types)

All tests operate in NDC coordinates. The lasso polygon is uploaded once as a flat uniform array before running Pass 2.

```glsl
#define MAX_LASSO_VERTS 256
uniform vec2 u_lasso[MAX_LASSO_VERTS];
uniform int  u_lasso_n;

// Winding-number point-in-polygon
float pointInLasso(vec2 p) {
    int winding = 0;
    for (int i = 0; i < u_lasso_n; i++) {
        vec2 a = u_lasso[i];
        vec2 b = u_lasso[(i + 1 == u_lasso_n) ? 0 : i + 1];
        if (a.y <= p.y) {
            if (b.y > p.y && (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x) > 0.0) winding++;
        } else {
            if (b.y <= p.y && (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x) < 0.0) winding--;
        }
    }
    return float(winding != 0);
}

// Segment-segment intersection test
bool segmentsIntersect(vec2 p0, vec2 p1, vec2 q0, vec2 q1) {
    vec2 d = p1-p0, e = q1-q0;
    float denom = d.x*e.y - d.y*e.x;
    if (abs(denom) < 1e-10) return false;
    vec2 f = q0-p0;
    float t = (f.x*e.y - f.y*e.x) / denom;
    float u = (f.x*d.y - f.y*d.x) / denom;
    return t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0;
}

// Segment selected if: either endpoint inside lasso, OR any lasso edge crosses segment
float segmentIntersectsLasso(vec2 p0, vec2 p1) {
    if (pointInLasso(p0) > 0.5 || pointInLasso(p1) > 0.5) return 1.0;
    for (int i = 0; i < u_lasso_n; i++) {
        vec2 a = u_lasso[i];
        vec2 b = u_lasso[(i + 1 == u_lasso_n) ? 0 : i + 1];
        if (segmentsIntersect(p0, p1, a, b)) return 1.0;
    }
    return 0.0;
}
```

### Scatter-write helper (shared by all Pass 2 shaders)

```glsl
uniform vec2  u_selTexSize;
out     float v_channel;

void scatterSelect(float pickId, float selected) {
    if (selected < 0.5) { gl_Position = vec4(10.0, 0.0, 0.0, 1.0); return; }
    float texelIdx = floor(pickId / 4.0);
    float tx = mod(texelIdx, u_selTexSize.x);
    float ty = floor(texelIdx / u_selTexSize.x);
    gl_Position = vec4(
        (tx + 0.5) / u_selTexSize.x * 2.0 - 1.0,
        (ty + 0.5) / u_selTexSize.y * 2.0 - 1.0,
        0.0, 1.0
    );
    v_channel = mod(pickId, 4.0);
    gl_PointSize = 1.0;
}
```

Pass 2 fragment shader (identical for all layer types):

```glsl
#version 300 es
precision highp float;
in  float v_channel;
out vec4  fragColor;
void main() {
    fragColor = vec4(
        v_channel < 0.5                     ? 1.0 : 0.0,
        v_channel >= 0.5 && v_channel < 1.5 ? 1.0 : 0.0,
        v_channel >= 1.5 && v_channel < 2.5 ? 1.0 : 0.0,
        v_channel >= 2.5                    ? 1.0 : 0.0
    );
}
```

---

## Phase 1 — Extract `buildSpatialGlsl`

The Pass 1 capture shader must apply the same axis transform as the render shader.

### `src/core/LayerType.js`
- Move `buildSpatialGlsl()` out to `src/axes/AxisRegistry.js`
- Replace with `import { buildSpatialGlsl } from "../axes/AxisRegistry.js"`

### `src/axes/AxisRegistry.js`
- Add `export function buildSpatialGlsl()` — exact same body, no logic change

**Test:** All existing layer rendering unaffected.

---

## Phase 2 — `SelectionColumn` and `SelectionRegistry`

*(Retain from existing plan — these remain correct.)*

`SelectionColumn` is a `TextureColumn` wrapping a regl FBO. `SelectionRegistry` is a `WeakMap<dataRef, Map<name, SelectionEntry>>` with one GPU texture per plot per selection name and a CPU mirror for cross-context sync.

---

## Phase 3 — `LassoMask.js`

*(Retain from existing plan — rasterizes the lasso polygon to a float FBO.)*

Note: the mask FBO is now used for **visual overlay only**. The lasso polygon is passed directly to Pass 2 as a `uniform vec2[]` array — no FBO sampling needed for the intersection test itself.

---

## Phase 4 — `u_mode` and Capture Mode in Vertex Shaders

### `src/core/LayerType.js` — inject capture mode

In `createDrawCommand()`, after the existing uniform and varying injections, add:

1. **Uniforms** (injected into all vertex shaders):
   ```glsl
   uniform float u_mode;              // 0=render, 1=capture
   uniform vec2  u_capture_tex_size;  // dimensions of position FBO
   uniform float u_capture_endpoint;  // 0 or 1 (for instanced layers)
   ```

2. **Varying** declared in vertex shader:
   ```glsl
   out vec4 v_capture_data;  // (ndcX, ndcY, pickId, endPoint)
   ```

3. **Capture branch** injected at the end of vertex shader `main()`, after `clipPos` is computed but before `gl_Position` is set for render mode:
   ```glsl
   if (u_mode == 1.0) {
       vec2 ndc = clipPos.xy / clipPos.w;
       float texW = u_capture_tex_size.x;
       float tx = mod(a_pickId, texW);
       float ty = floor(a_pickId / texW);
       gl_Position = vec4(
           (tx + 0.5) / texW * 2.0 - 1.0,
           (ty + 0.5) / u_capture_tex_size.y * 2.0 - 1.0,
           0.0, 1.0
       );
       gl_PointSize = 1.0;
       v_capture_data = vec4(ndc, a_pickId, u_capture_endpoint);
       return;
   }
   ```

4. **Fragment shader capture branch** (injected at top of `main()`):
   ```glsl
   if (u_mode == 1.0) { fragColor = v_capture_data; return; }
   ```

5. **`layer.captureDrawCmd`** — built alongside `layer.draw` using the same vertex shader, but:
   - `primitive: 'points'`
   - Simple fragment shader that just outputs `v_capture_data`
   - `depth: { enable: false }`, `blend: { enable: false }`

All existing render calls pass `u_mode: 0.0` — the capture branch is never entered during normal rendering.

---

## Phase 5 — `PositionCapture.js`

### New file: `src/selection/PositionCapture.js`

Allocates a float RGBA FBO and runs `layer.captureDrawCmd` to fill it.

```js
export class PositionCapture {
  constructor(regl) { this._regl = regl }

  // Returns a regl framebuffer: texel i = (ndcX, ndcY, pickId, endPoint)
  // Caller is responsible for .destroy() after use.
  run(captureDrawCmd, layerProps, n, endPoint = 0) {
    const w = Math.ceil(Math.sqrt(n))
    const h = Math.ceil(n / w)
    const fbo = this._regl.framebuffer({
      width: w, height: h,
      colorFormat: 'rgba', colorType: 'float', depth: false
    })
    this._regl({ framebuffer: fbo })(() => this._regl.clear({ color: [0,0,0,0] }))
    captureDrawCmd({
      ...layerProps,
      u_mode: 1.0,
      u_capture_tex_size: [w, h],
      u_capture_endpoint: endPoint,
    })
    return fbo
  }
}
```

---

## Phase 6 — `SelectionTestPass.js`

### New file: `src/selection/SelectionTestPass.js`

Shared by all layer types. Takes the position FBO(s) from Phase 5 plus the lasso polygon, outputs into a `SelectionColumn` FBO.

```js
export class SelectionTestPass {
  constructor(regl) {
    this._regl       = regl
    this._pointCmd   = this._build(regl, POINT_SEL_VERT)
    this._segmentCmd = this._build(regl, SEGMENT_SEL_VERT)
  }

  _build(regl, vert) {
    return regl({
      vert, frag: SEL_FRAG,
      attributes: {},
      uniforms: {
        u_pos_tex:    regl.prop('posTex'),
        u_pos1_tex:   regl.prop('pos1Tex'),
        u_pos_tex_w:  regl.prop('posTexW'),
        u_selTexSize: regl.prop('selTexSize'),
        u_lasso:      regl.prop('lasso'),
        u_lasso_n:    regl.prop('lassoN'),
      },
      framebuffer: regl.prop('selFbo'),
      primitive: 'points',
      instances: regl.prop('count'),
      count: 1,
      depth: { enable: false },
      blend: { enable: true, func: { src: 'one', dst: 'one' } },
    })
  }

  runPoints(posFbo, selectionColumn, lassoNdc) {
    this._pointCmd({
      posTex:    posFbo.color[0],
      posTexW:   posFbo.width,
      selTexSize:[selectionColumn.texW, selectionColumn.texH],
      selFbo:    selectionColumn.fbo,
      lasso:     lassoNdc,
      lassoN:    lassoNdc.length / 2,
      count:     posFbo.width * posFbo.height,
    })
  }

  runSegments(pos0Fbo, pos1Fbo, selectionColumn, lassoNdc) {
    this._segmentCmd({
      posTex:    pos0Fbo.color[0],
      pos1Tex:   pos1Fbo.color[0],
      posTexW:   pos0Fbo.width,
      selTexSize:[selectionColumn.texW, selectionColumn.texH],
      selFbo:    selectionColumn.fbo,
      lasso:     lassoNdc,
      lassoN:    lassoNdc.length / 2,
      count:     pos0Fbo.width * pos0Fbo.height,
    })
  }
}
```

Pass 2 vertex shaders:

```js
const POINT_SEL_VERT = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D u_pos_tex;
uniform float     u_pos_tex_w;
${LASSO_GLSL}
void main() {
    ivec2 tc = ivec2(int(mod(float(gl_InstanceID), u_pos_tex_w)),
                     int(float(gl_InstanceID) / u_pos_tex_w));
    vec4 d   = texelFetch(u_pos_tex, tc, 0);
    scatterSelect(d.z, pointInLasso(d.xy));
}`

const SEGMENT_SEL_VERT = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D u_pos_tex;
uniform sampler2D u_pos1_tex;
uniform float     u_pos_tex_w;
${LASSO_GLSL}
void main() {
    ivec2 tc = ivec2(int(mod(float(gl_InstanceID), u_pos_tex_w)),
                     int(float(gl_InstanceID) / u_pos_tex_w));
    vec4 d0 = texelFetch(u_pos_tex,  tc, 0);
    vec4 d1 = texelFetch(u_pos1_tex, tc, 0);
    scatterSelect(d0.z, segmentIntersectsLasso(d0.xy, d1.xy));
}`
```

Where `LASSO_GLSL` is a shared string constant containing the `pointInLasso`, `segmentsIntersect`, `segmentIntersectsLasso`, and `scatterSelect` functions listed in the Intersection Tests section above.

---

## Phase 7 — `SelectionPipeline.js` (rewrite)

```js
import { PositionCapture }    from "./PositionCapture.js"
import { SelectionTestPass }  from "./SelectionTestPass.js"
import { LassoMask }          from "./LassoMask.js"

export class SelectionPipeline {
  constructor(regl, plot) {
    this._regl    = regl
    this._plot    = plot
    this._capture = new PositionCapture(regl)
    this._test    = new SelectionTestPass(regl)
    this._mask    = new LassoMask(regl, plot.width, plot.height)
  }

  async runLasso(vertices, selectionColumns) {
    const plot = this._plot

    // Visual overlay
    this._mask.update(vertices, plot.height)

    // Convert lasso from HTML canvas coords (top-left, pixels) to NDC
    const w = plot.width, h = plot.height
    const lassoNdc = new Float32Array(vertices.length * 2)
    for (let i = 0; i < vertices.length; i++) {
      lassoNdc[i*2+0] =  vertices[i][0] / w * 2.0 - 1.0
      lassoNdc[i*2+1] = -(vertices[i][1] / h * 2.0 - 1.0)  // flip Y: HTML top-left → GL bottom-left
    }

    // Refresh computed data columns
    for (const node of plot._dataTransformNodes) await node.refreshIfNeeded(plot)
    for (const layer of plot.layers)
      for (const col of layer._dataColumns ?? []) await col.refresh(plot)

    // Clear selection textures
    for (const col of selectionColumns.values()) col.clear()

    // Two-pass selection per layer
    for (const [layerIdx, selCol] of selectionColumns) {
      const layer = plot.layers[layerIdx]
      const props = plot._buildLayerProps(layer, layerIdx, {})
      const N     = layer.instanceCount ?? layer.vertexCount ?? 0
      if (N === 0) continue

      if (layer.instanceCount != null) {
        // Instanced layer (lines, etc.): capture both endpoints separately
        const pos0 = this._capture.run(layer.captureDrawCmd, props, N, 0)
        const pos1 = this._capture.run(layer.captureDrawCmd, props, N, 1)
        this._test.runSegments(pos0, pos1, selCol, lassoNdc)
        pos0.destroy(); pos1.destroy()
      } else {
        // Non-instanced layer (points, bars, etc.)
        const pos = this._capture.run(layer.captureDrawCmd, props, N, 0)
        this._test.runPoints(pos, selCol, lassoNdc)
        pos.destroy()
      }
    }
  }

  resize(w, h) { this._mask.resize(w, h) }
  destroy()    { this._mask.destroy() }
}
```

---

## Phase 8 — `Plot.js` changes

### `_buildLayerProps` — add `u_mode`

```js
_buildLayerProps(layer, layerIdx, opts = {}) {
  return {
    ...existingProps,
    u_mode: opts.u_mode ?? 0.0,
    // u_idLo / u_idHi no longer needed — remove
  }
}
```

### `selectLasso(vertices)`

*(Same structure as existing plan — collect `selectionColumns` map, instantiate `SelectionPipeline` on demand, call `runLasso`, notify registry for cross-plot sync.)*

---

## Phase 9 — Colorscale Selection Variant

*(Unchanged from existing plan.)*

`map_color_s_sel()` added to `ColorscaleRegistry.js`. When a layer has a `selectionName`, `LayerType.createDrawCommand()` injects the `SelectionColumn` as a uniform and replaces `map_color_*` calls with the selection-aware variant (30% black mix for selected points).

---

## Phase 10 — Lasso Interaction Handler

*(Unchanged from existing plan.)*

`LassoInteraction.js`: mousedown/mousemove/mouseup on the canvas, SVG polyline overlay, minimum 5px spacing between recorded vertices, calls `plot.selectLasso(vertices)` on mouseup.

---

## Phase 11 — Cross-Plot Linked Selection

*(Unchanged from existing plan.)*

`SelectionRegistry.notifyFromGpu()` reads back the source plot's SelectionColumn to a CPU Float32Array mirror, then uploads it to every other subscriber's GPU texture and schedules their re-renders.

---

## What this replaces

| Old component | Fate | Reason |
|---|---|---|
| `PickCountFbo` | **Delete** | Worked in pixel space; missed all occluded primitives |
| `GatherPass` | **Delete** | Read from pick/count FBOs; only resolved frontmost items per pixel |
| Halving loop in `SelectionPipeline` | **Delete** | O(log N) passes, only correct when primitives never overlap on screen |
| `drawCount` per layer | **Delete** | Only needed for count FBO |
| `u_idLo` / `u_idHi` uniforms | **Delete** | Only needed for halving loop range splitting |

---

## File Summary

| File | Status | Changes |
|---|---|---|
| `src/axes/AxisRegistry.js` | Modify | Export `buildSpatialGlsl()` |
| `src/core/LayerType.js` | Modify | Inject `u_mode` + capture branch into all vertex shaders; add `layer.captureDrawCmd` |
| `src/core/Plot.js` | Modify | `_buildLayerProps` with `u_mode`; `selectLasso()`; selection column registration |
| `src/colorscales/ColorscaleRegistry.js` | Modify | Add `map_color_s_sel()` |
| `src/selection/SelectionColumn.js` | Keep | No changes |
| `src/selection/SelectionRegistry.js` | Keep | No changes |
| `src/selection/LassoMask.js` | Keep | Visual overlay only |
| `src/selection/PositionCapture.js` | **New** | Runs vertex shader in capture mode → position FBO |
| `src/selection/SelectionTestPass.js` | **New** | Instanced per-primitive intersection test → SelectionColumn |
| `src/selection/SelectionPipeline.js` | Rewrite | Two-pass orchestration; no halving loop |
| `src/selection/LassoInteraction.js` | Keep | No changes |
| `src/selection/PickCountFbo.js` | **Delete** | |
| `src/selection/GatherPass.js` | **Delete** | |

## Implementation Order

1. Phase 1 — extract `buildSpatialGlsl`; verify rendering unchanged
2. Phase 4 — inject `u_mode` uniform; verify `u_mode=0` is a no-op in all layers
3. Phase 4 (cont.) — inject capture branch; visually verify position FBO with a debug readback
4. Phase 5 — `PositionCapture`; unit test against known positions
5. Phase 6 — `SelectionTestPass` with point test; verify point selection end-to-end
6. Phase 6 (cont.) — add segment test; verify `LinesLayer` selection
7. Phase 7 — rewrite `SelectionPipeline`; remove halving loop
8. Phase 8 — `Plot.js` integration
9. Phase 9 — colorscale dimming
10. Phase 10 — `LassoInteraction`
11. Phase 11 — cross-plot sync
