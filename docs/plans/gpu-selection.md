# GPU-Driven Lasso Selection — Detailed Implementation Plan

## Overview

Lasso selection produces a **`SelectionColumn`** (a `TextureColumn` of 0/1 floats, 4-packed, length N) tied to a specific dataset. The selection is a first-class data channel: once computed it can drive color or filter declaratively. The pipeline uses a hierarchical GPU pick algorithm to correctly find all selected data points including occluded ones.

Multiple named selections can exist simultaneously (e.g. `"groupA"`, `"groupB"`). Each selection is tied to a specific raw dataset by object identity. Two layers in different plots automatically share a selection if and only if they declare the same selection name **and** their plots were given the same JS data object. This mirrors how `AxisLink` works — linking is implicit through shared references, not through a global name lookup.

Transformed layers (histograms, KDE, etc.) have a different N from the raw data and cannot be directly selected. They consume a selection as a computation input (e.g. a filtered histogram showing selected vs. unselected counts).

---

## Phase 1 — Extract `buildSpatialGlsl` from `LayerType.js`

**Why first:** The selection scatter pass must apply the same axis transform as the render shader. The function already exists — it just needs to be importable from outside `LayerType.js`.

### `src/core/LayerType.js`
- Move `buildSpatialGlsl()` (lines 7–39) out of the file
- Add `import { buildSpatialGlsl } from "../axes/AxisRegistry.js"` at top

### `src/axes/AxisRegistry.js`
- Add `export function buildSpatialGlsl()` with the exact same body:
  ```glsl
  // uniforms: xDomain, yDomain, zDomain (vec2), xScaleType, yScaleType, zScaleType (float),
  //           u_is3D (float), u_mvp (mat4)
  // provides: normalize_axis(v, domain, scaleType) → float [0,1]
  //           plot_pos(vec2) → vec4 clip coords
  //           plot_pos_3d(vec3) → vec4 clip coords
  //           v_clip_pos (out vec3)
  ```
- No logic changes — purely a move + export.

**Test:** All existing layer rendering must be unaffected. Run the example.

---

## Phase 2 — `SelectionColumn` and `SelectionRegistry`

### New file: `src/selection/SelectionColumn.js`

A `TextureColumn` wrapping a mutable regl FBO used as the selection output target.

```js
import { TextureColumn } from "../data/ColumnData.js"

export class SelectionColumn extends TextureColumn {
  // n: number of data points this column covers
  constructor(regl, n) {
    const texW = Math.ceil(Math.sqrt(Math.ceil(n / 4)))
    const texH = Math.ceil(Math.ceil(n / 4) / texW)
    const tex = regl.texture({ width: texW, height: texH, format: 'rgba', type: 'float',
                                data: new Float32Array(texW * texH * 4) })
    super({ texture: tex }, null)
    this._regl = regl
    this._n = n
    this._texW = texW
    this._texH = texH
    this._fbo = regl.framebuffer({ color: tex, depth: false })
  }

  get fbo()   { return this._fbo }
  get texW()  { return this._texW }
  get texH()  { return this._texH }
  get length(){ return this._n }

  clear() {
    this._regl({ framebuffer: this._fbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
    })
  }

  destroy() { this._fbo.destroy() }
}
```

### New file: `src/selection/SelectionRegistry.js`

The registry is keyed by `(dataRef, selectionName)` where `dataRef` is the raw JS data object passed to `plot.update({ data: ... })`. Two layers share a selection if and only if they use the same selection name **and** the same data object reference.

Each entry holds a CPU-side mirror of the selection plus one GPU `SelectionColumn` per subscribed plot. The CPU mirror is necessary because GPU textures cannot be shared across WebGL contexts (each plot has its own canvas and context). After a lasso completes in one plot, a single readback populates the CPU mirror, which is then uploaded to every other subscriber's GPU texture.

```js
// SelectionEntry: one per (dataRef, name) pair
// {
//   n:           number,                        dataset size — enforced to match across all subscribers
//   data:        Float32Array,                  CPU mirror, 4-packed 0/1 values, length = ceil(n/4)*4
//   subscribers: Map<Plot, SelectionColumn>     one GPU texture per GL context
// }

export class SelectionRegistry {
  constructor() {
    // WeakMap so dataRef objects can be GC'd when no plot holds them
    this._entries = new WeakMap()   // dataRef → Map<name, SelectionEntry>
  }

  _getOrCreateEntry(dataRef, name, n) {
    if (!this._entries.has(dataRef)) this._entries.set(dataRef, new Map())
    const byName = this._entries.get(dataRef)
    if (!byName.has(name)) {
      byName.set(name, {
        n,
        data: new Float32Array(Math.ceil(n / 4) * 4),
        subscribers: new Map(),
      })
    } else {
      const entry = byName.get(name)
      if (entry.n !== n) {
        console.warn(
          `[gladly] SelectionRegistry: selection "${name}" already registered with n=${entry.n}, ` +
          `but new subscriber has n=${n}. These layers do not share the same dataset — ` +
          `they will not be linked. Ensure both plots receive the same data object to link selections.`
        )
        return null   // caller should treat this as an unlinked selection
      }
    }
    return byName.get(name)
  }

  // Called by Plot._initialize() for each layer that declares a selection binding.
  // dataRef = plot._lastRawDataArg (the original JS data object, before normalizeData())
  // n = layer.instanceCount ?? layer.vertexCount
  // Returns a SelectionColumn for this plot's GL context.
  register(dataRef, name, plot, regl, n) {
    const entry = this._getOrCreateEntry(dataRef, name, n)
    if (!entry) return null   // n mismatch — skip linking

    if (!entry.subscribers.has(plot)) {
      const col = new SelectionColumn(regl, n)
      entry.subscribers.set(plot, col)
    }
    return entry.subscribers.get(plot)
  }

  // Retrieve the SelectionColumn for a specific plot, or null if not registered.
  get(dataRef, name, plot) {
    return this._entries.get(dataRef)?.get(name)?.subscribers.get(plot) ?? null
  }

  // Called by SelectionPipeline after the GPU halving loop completes in sourcePlot.
  // Reads back sourcePlot's SelectionColumn to the CPU mirror, then uploads
  // to all other subscribers' GPU textures and schedules their re-renders.
  notifyFromGpu(dataRef, name, sourcePlot) {
    const entry = this._entries.get(dataRef)?.get(name)
    if (!entry) return

    // 1. Readback from source plot's GPU texture → CPU mirror
    const sourceCol = entry.subscribers.get(sourcePlot)
    if (!sourceCol) return
    sourcePlot.regl({ framebuffer: sourceCol.fbo })(() => {
      const pixels = sourcePlot.regl.read()
      entry.data.set(pixels)
    })

    // 2. Upload CPU mirror to all other subscribers and schedule re-render
    for (const [plot, col] of entry.subscribers) {
      if (plot === sourcePlot) {
        plot.scheduleRender()
        continue
      }
      col._ref.texture.subimage({ data: entry.data, width: col.texW, height: col.texH })
      plot.scheduleRender()
    }
  }

  // Remove a plot's subscription (called on plot destroy or data change).
  unregister(dataRef, name, plot) {
    const entry = this._entries.get(dataRef)?.get(name)
    if (!entry) return
    entry.subscribers.get(plot)?.destroy()
    entry.subscribers.delete(plot)
  }
}

// Module-level singleton (like ColorscaleRegistry)
export const globalSelectionRegistry = new SelectionRegistry()
```

### Matching rules summary

| Scenario | Result |
|---|---|
| Plot A and B both receive `data = myData`, both layers declare `selection: "brush1"` | Linked — share one `SelectionEntry`; GPU textures are separate but CPU mirror syncs them |
| Plot A and B receive different data objects (even same contents), same `selection: "brush1"` | Not linked — separate `SelectionEntry` per `dataRef` |
| Same plot, two layers from different datasets, both declare `selection: "brush1"` | Not linked — different `dataRef` → different entries |
| Same plot, two layers from same dataset, both declare `selection: "brush1"` | Linked — same `SelectionColumn` (same plot, same `dataRef`) |
| N mismatch on same `dataRef` + name | Warning + unlinked |

### Transformed layers

Transforms (histogram, KDE, FFT) produce derived data with different N. They cannot be directly selected. Instead they consume a `SelectionColumn` as a computation input:

```js
// Histogram that shows selected vs. unselected counts as separate outputs
transforms: [
  { name: "hist", transform: {
    HistogramData: { input: "input.y", selectionFilter: "brush1", bins: 50 }
  }}
]
// hist.counts        → total counts per bin
// hist.selectedCounts → counts of selected points per bin
```

The `HistogramData` computation receives the `SelectionColumn` for `"brush1"` over the raw data and uses it to partition counts. This is a computation over the selection, not a selection of transformed data.

### `src/index.js`
- Export `SelectionRegistry`, `globalSelectionRegistry`, `SelectionColumn`

---

## Phase 3 — Mask FBO (lasso polygon rasterization)

### New file: `src/selection/LassoMask.js`

Converts an array of screen-space mouse coords into a filled polygon in an offscreen FBO.

```js
export class LassoMask {
  constructor(regl, width, height) {
    this._regl = regl
    this._fbo = regl.framebuffer({ width, height, colorFormat: 'rgba',
                                   colorType: 'float', depth: false })
    this._drawCmd = regl({
      vert: `#version 300 es
        in vec2 a_pos;           // screen pixels
        uniform vec2 u_size;
        void main() {
          gl_Position = vec4(a_pos / u_size * 2.0 - 1.0, 0.0, 1.0);
        }`,
      frag: `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() { fragColor = vec4(1.0); }`,
      attributes: { a_pos: regl.prop('verts') },
      uniforms:   { u_size: regl.prop('size') },
      framebuffer: regl.prop('fbo'),
      primitive: 'triangles',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: false },
    })
  }

  // vertices: [[x, y], ...] in screen pixels (top-left origin, HTML coords)
  // Converts to GL coords (bottom-left) before triangulation.
  update(vertices, canvasHeight) {
    this._regl({ framebuffer: this._fbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
    })
    if (vertices.length < 3) return

    // Fan triangulation: (centroid, v[i], v[i+1]) for each edge
    const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length
    const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length
    const glY = y => canvasHeight - y   // flip to GL coords

    const verts = []
    for (let i = 0; i < vertices.length; i++) {
      const [ax, ay] = vertices[i]
      const [bx, by] = vertices[(i + 1) % vertices.length]
      verts.push(cx, glY(cy), ax, glY(ay), bx, glY(by))
    }

    this._drawCmd({
      verts: new Float32Array(verts),
      size: [this._fbo.width, this._fbo.height],
      fbo: this._fbo,
      count: verts.length / 2,
    })
  }

  get fbo() { return this._fbo }

  resize(width, height) { this._fbo.resize(width, height) }
  destroy() { this._fbo.destroy() }
}
```

**Note on concave lassos:** Fan triangulation from centroid is correct for convex polygons. For concave lassos, replace with a proper ear-clipping or stencil-based even-odd fill. Defer to a follow-up; for MVP use fan triangulation.

---

## Phase 4 — Pick FBO and Count FBO

### New file: `src/selection/PickCountFbo.js`

Refactors the existing `Plot.pick()` FBO logic into a reusable class that adds a second count render target.

```js
export class PickCountFbo {
  constructor(regl, width, height) {
    this._regl = regl

    // Pick FBO: uint8 rgba — same encoding as Plot.pick()
    this._pickTex   = regl.texture({ width, height, format: 'rgba', type: 'uint8' })
    this._pickFbo   = regl.framebuffer({ color: this._pickTex, depth: true })

    // Count FBO: float, additive-blended, no depth test
    // Each rendered primitive adds 1/255 per fragment — values > 1/255 → multiple items
    this._countTex  = regl.texture({ width, height, format: 'rgba', type: 'float' })
    this._countFbo  = regl.framebuffer({ color: this._countTex, depth: false })
  }

  // Renders all layers into both FBOs.
  // layers: plot.layers; buildProps: function(layer, pickMode) → props object (extracted from Plot)
  renderAll(plot, layers, buildProps) {
    // Pass 1: pick FBO with depth test (topmost item per pixel)
    this._regl({ framebuffer: this._pickFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0], depth: 1 })
      for (let i = 0; i < layers.length; i++) {
        layers[i].draw(buildProps(layers[i], i, { pickMode: 1.0 }))
      }
    })

    // Pass 2: count FBO — same draw commands but additive blend, no depth
    this._regl({ framebuffer: this._countFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
      // Each layer renders with special count shader (outputs 1/255 per fragment)
      for (let i = 0; i < layers.length; i++) {
        layers[i].drawCount(buildProps(layers[i], i, { pickMode: 0.0 }))
      }
    })
  }

  // Renders only items with pickId in [lo, hi) for a specific layer.
  // Used during halving passes.
  renderRange(plot, layer, layerIdx, buildProps, lo, hi) {
    this._regl({ framebuffer: this._pickFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0], depth: 1 })
      layer.draw(buildProps(layer, layerIdx, { pickMode: 1.0, idLo: lo, idHi: hi }))
    })
    this._regl({ framebuffer: this._countFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
      layer.drawCount(buildProps(layer, layerIdx, { pickMode: 0.0, idLo: lo, idHi: hi }))
    })
  }

  get pickFbo()  { return this._pickFbo }
  get countFbo() { return this._countFbo }

  resize(w, h) {
    this._pickTex.resize(w, h); this._pickFbo.resize(w, h)
    this._countTex.resize(w, h); this._countFbo.resize(w, h)
  }
  destroy() { this._pickFbo.destroy(); this._countFbo.destroy() }
}
```

### Count shader addition to `LayerType.js`

Add a second draw command `layer.drawCount` alongside `layer.draw`. The count draw command uses the same vertex shader but a simplified fragment shader:

```glsl
// Count fragment shader — additive blend writes 1/255 per covered fragment
out vec4 fragColor;
void main() { fragColor = vec4(1.0/255.0); }
```

In `LayerType.createDrawCommand()`, after building `drawConfig`, also build a `drawCountConfig` that:
- Uses the same vertex shader (so same per-item geometry and positioning)
- Uses the simplified fragment shader above
- Uses `blend: { enable: true, func: { src: 'one', dst: 'one' } }` (additive)
- Does **not** enable depth testing

Store both on the layer object: `layer.draw = regl(drawConfig)`, `layer.drawCount = regl(drawCountConfig)`.

### `u_idLo` / `u_idHi` uniforms for range filtering

Add two uniforms to the vertex shader:
```glsl
uniform float u_idLo;  // default 0.0
uniform float u_idHi;  // default 1e9 (effectively all)
```

In `injectPickIdAssignment()` (or a new injection), add at the end of vertex `main()`:
```glsl
if (a_pickId < u_idLo || a_pickId >= u_idHi) gl_Position = vec4(10.0, 0.0, 0.0, 1.0);
```
This clips vertices outside the current range, so the render/count passes only cover items in [lo, hi).

`buildProps()` in Plot passes `u_idLo: lo ?? 0`, `u_idHi: hi ?? 1e9` as uniforms.

---

## Phase 5 — Gather Pass (point-sprite scatter-write)

### New file: `src/selection/GatherPass.js`

For each screen pixel where `mask=1 AND count≤1/255` (single item), emits a point sprite that lands at the pickId's texel position in the selection texture FBO.

```js
export class GatherPass {
  constructor(regl, canvasW, canvasH) {
    // One vertex per screen pixel in the canvas.
    // Pre-built as a flat [0,0, 1,0, 2,0, ...] grid.
    const verts = new Float32Array(canvasW * canvasH * 2)
    for (let y = 0; y < canvasH; y++)
      for (let x = 0; x < canvasW; x++) {
        verts[(y * canvasW + x) * 2 + 0] = x
        verts[(y * canvasW + x) * 2 + 1] = y
      }
    this._pixelCount = canvasW * canvasH
    this._cmd = regl({
      vert: GATHER_VERT,
      frag: GATHER_FRAG,
      attributes: { a_pixel: { buffer: regl.buffer(verts), size: 2 } },
      uniforms: {
        u_pickFbo:   regl.prop('pickFbo'),
        u_countFbo:  regl.prop('countFbo'),
        u_maskFbo:   regl.prop('maskFbo'),
        u_screenSize: regl.prop('screenSize'),
        u_selTexSize: regl.prop('selTexSize'),
        u_idLo:      regl.prop('idLo'),
        u_idHi:      regl.prop('idHi'),
        u_layerIdx:  regl.prop('layerIdx'),
      },
      framebuffer: regl.prop('selFbo'),
      primitive: 'points',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: true, func: { src: 'one', dst: 'one' } },  // additive
    })
  }

  // selectionColumn: SelectionColumn; layerIdx: which layer (R channel in pick FBO)
  run(pickFbo, countFbo, maskFbo, selectionColumn, layerIdx, lo, hi) {
    this._cmd({
      pickFbo, countFbo, maskFbo,
      screenSize: [pickFbo.width, pickFbo.height],
      selTexSize: [selectionColumn.texW, selectionColumn.texH],
      selFbo: selectionColumn.fbo,
      idLo: lo, idHi: hi,
      layerIdx,
      count: this._pixelCount,
    })
  }
}

const GATHER_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 a_pixel;          // screen pixel coords [0, W) x [0, H), GL coords (y-up)
uniform sampler2D u_pickFbo;
uniform sampler2D u_countFbo;
uniform sampler2D u_maskFbo;
uniform vec2 u_screenSize;
uniform vec2 u_selTexSize;
uniform float u_idLo;
uniform float u_idHi;
uniform float u_layerIdx;   // expected layerIdx (1-based, as encoded in pick FBO R channel)
out float v_channel;

void main() {
  gl_PointSize = 1.0;
  vec2 uv = (a_pixel + 0.5) / u_screenSize;

  float mask  = texture(u_maskFbo,  uv).r;
  float count = texture(u_countFbo, uv).r;

  if (mask < 0.5 || count > 1.5 / 255.0) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);  // clip — not resolved
    return;
  }

  vec4 pick = texture(u_pickFbo, uv);
  float layerEnc = pick.r * 255.0;   // R = layerIdx (1-based)
  if (abs(layerEnc - u_layerIdx) > 0.5) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);  // different layer
    return;
  }

  // Decode pickId from G, B, A channels
  float g = pick.g * 255.0;
  float b = pick.b * 255.0;
  float a = pick.a * 255.0;
  float pickId = g * 65536.0 + b * 256.0 + a;

  if (pickId < u_idLo || pickId >= u_idHi) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);
    return;
  }

  // Position in selection texture: texelIdx = floor(pickId / 4), channel = mod(pickId, 4)
  float texelIdx = floor(pickId / 4.0);
  float tx = mod(texelIdx, u_selTexSize.x);
  float ty = floor(texelIdx / u_selTexSize.x);
  gl_Position = vec4(
    (tx + 0.5) / u_selTexSize.x * 2.0 - 1.0,
    (ty + 0.5) / u_selTexSize.y * 2.0 - 1.0,
    0.0, 1.0
  );

  v_channel = mod(pickId, 4.0);   // 0=r 1=g 2=b 3=a
}`

const GATHER_FRAG = `#version 300 es
precision highp float;
in float v_channel;
out vec4 fragColor;
void main() {
  // Write 1.0 only into the channel corresponding to pickId % 4
  fragColor = vec4(
    v_channel < 0.5              ? 1.0 : 0.0,
    v_channel >= 0.5 && v_channel < 1.5 ? 1.0 : 0.0,
    v_channel >= 1.5 && v_channel < 2.5 ? 1.0 : 0.0,
    v_channel >= 2.5             ? 1.0 : 0.0
  );
}`
```

---

## Phase 6 — Selection Pipeline (halving loop)

### New file: `src/selection/SelectionPipeline.js`

Orchestrates the full algorithm: mask FBO → initial pick+count → gather → halving until resolved.

```js
export class SelectionPipeline {
  constructor(regl, plot) {
    this._regl = regl
    this._plot = plot
    this._pickCount = new PickCountFbo(regl, plot.width, plot.height)
    this._gather    = new GatherPass(regl, plot.width, plot.height)
    this._mask      = new LassoMask(regl, plot.width, plot.height)
  }

  // Main entry point: call on mouseup with accumulated polygon vertices.
  // vertices: [[x, y], ...] in HTML (top-left origin) canvas coords
  // selectionColumns: Map<layerIdx, SelectionColumn> — one per relevant layer
  async runLasso(vertices, selectionColumns) {
    const plot = this._plot

    // 1. Rasterize lasso polygon into mask FBO
    this._mask.update(vertices, plot.height)

    // 2. Refresh data (same as pick/render)
    for (const node of plot._dataTransformNodes) await node.refreshIfNeeded(plot)
    for (const layer of plot.layers)
      for (const col of layer._dataColumns ?? []) await col.refresh(plot)

    // 3. Clear all selection textures
    for (const col of selectionColumns.values()) col.clear()

    // 4. Halving loop per layer
    for (const [layerIdx, selCol] of selectionColumns) {
      const layer = plot.layers[layerIdx]
      const N = layer.instanceCount ?? layer.vertexCount
      await this._resolveLayer(layer, layerIdx, selCol, N)
    }
  }

  async _resolveLayer(layer, layerIdx, selCol, N) {
    const MAX_HALVINGS = Math.ceil(Math.log2(N)) + 1
    await this._halvingStep(layer, layerIdx, selCol, 0, N, 0, MAX_HALVINGS)
  }

  async _halvingStep(layer, layerIdx, selCol, lo, hi, depth, maxDepth) {
    if (lo >= hi || depth > maxDepth) return

    const buildProps = (l, idx, opts) => this._plot._buildLayerProps(l, idx, opts)

    // Render items [lo, hi) into pick + count FBOs
    this._pickCount.renderRange(this._plot, layer, layerIdx, buildProps, lo, hi)

    // Gather: write single-covered lasso pixels into selection texture
    this._gather.run(
      this._pickCount.pickFbo,
      this._pickCount.countFbo,
      this._mask.fbo,
      selCol,
      layerIdx + 1,  // 1-based layer encoding in pick FBO
      lo, hi
    )

    if (hi - lo <= 1) return  // fully resolved — single item

    // Recurse on lower and upper halves
    const mid = Math.floor((lo + hi) / 2)
    await this._halvingStep(layer, layerIdx, selCol, lo,  mid, depth + 1, maxDepth)
    await this._halvingStep(layer, layerIdx, selCol, mid, hi,  depth + 1, maxDepth)
  }

  resize(w, h) {
    this._pickCount.resize(w, h)
    this._gather.resize(w, h)
    this._mask.resize(w, h)
  }
  destroy() {
    this._pickCount.destroy()
    this._gather.destroy()
    this._mask.destroy()
  }
}
```

**Note on GPU sync:** The recursive `await` is a JS-level loop. Each `renderRange`/`gather` call is a synchronous GPU submit (regl queues commands). There is no explicit CPU→GPU readback in the hot loop. The `await` is only for JS async scheduling, not GPU sync. All draw calls execute on the GPU asynchronously; the browser drives the pipeline.

**Optimization:** The recursion above visits every node in the binary tree even if already resolved. A later optimization: before recursing, check whether the count FBO shows any multi-covered pixels in the current range (using an occlusion query or a small readback of the count FBO only). Skip subtrees where count=0 in the scissored area.

---

## Phase 7 — `Plot.js` changes

### New method: `Plot._buildLayerProps(layer, layerIdx, opts)`

Extract the existing prop-building logic from `Plot.pick()` and `Plot.render()` into a single shared method. Add `u_idLo`, `u_idHi` from `opts`:

```js
_buildLayerProps(layer, layerIdx, { pickMode = 0.0, idLo = 0, idHi = 1e9 } = {}) {
  // ... existing domain/scale prop logic from pick() ...
  return {
    ...existingProps,
    u_pickingMode: pickMode,
    u_pickLayerIndex: layerIdx,
    u_idLo: idLo,
    u_idHi: idHi,
  }
}
```

Update `Plot.pick()` and `Plot.render()` to call `_buildLayerProps()`.

### New method: `Plot.selectLasso(vertices)`

Public API method. Called on mouseup.

```js
async selectLasso(vertices) {
  // Build selectionColumns map for all layers that have a selection binding
  const selectionColumns = new Map()
  for (let i = 0; i < this.layers.length; i++) {
    const layer = this.layers[i]
    if (layer.selectionName) {
      const col = globalSelectionRegistry.get(layer.selectionName)
      if (col) selectionColumns.set(i, col)
    }
  }
  if (selectionColumns.size === 0) return

  if (!this._selectionPipeline) {
    this._selectionPipeline = new SelectionPipeline(this.regl, this)
  }

  await this._selectionPipeline.runLasso(vertices, selectionColumns)

  // Readback from this plot's GPU textures → CPU mirror → upload to all other subscribers
  for (const layer of this.layers) {
    if (layer.selectionName && layer.selectionColumn) {
      globalSelectionRegistry.notifyFromGpu(
        this._lastRawDataArg,
        layer.selectionName,
        this
      )
    }
  }
}
```

### `Plot._initialize()` — register selection columns

When processing layers, if a layer config declares a `selection` field, register the `SelectionColumn` in the registry using `this._lastRawDataArg` as the data identity key:

```js
if (layerConfig.selection) {
  const N = layer.instanceCount ?? layer.vertexCount
  const selCol = globalSelectionRegistry.register(
    this._lastRawDataArg,   // dataRef — object identity, not value equality
    layerConfig.selection,
    this,
    this.regl,
    N
  )
  layer.selectionName   = layerConfig.selection
  layer.selectionColumn = selCol   // null if N mismatch (unlinked)
}
```

On `_initialize()` being called again (data/config change), unregister old selections before re-registering:

```js
// At start of _initialize(), before building new layers:
for (const layer of this.layers) {
  if (layer.selectionName) {
    globalSelectionRegistry.unregister(this._lastRawDataArg, layer.selectionName, this)
  }
}
```

### `Plot` resize handler
- Call `this._selectionPipeline?.resize(width, height)` in `_setupResizeObserver`.

---

## Phase 8 — `Layer.js` changes

Add `selectionName` field:

```js
// In Layer constructor
this.selectionName = config.selectionName ?? null
```

The `SelectionColumn` for a layer is accessed via `globalSelectionRegistry.get(this.selectionName)` at render time.

---

## Phase 9 — Colorscale selection variant

### `src/colorscales/ColorscaleRegistry.js`

Add `map_color_s_sel()` to `buildColorGlsl()`:

```glsl
// Like map_color_s but modulates based on a selection value.
// selected < -0.5: no active selection (identity — no visual change)
// selected = 0.0: not selected
// selected = 1.0: selected
// Default behavior: dim unselected points. Colorscales can register a GLSL override.
vec4 map_color_s_sel(int cs, vec2 range, float v, float scaleType, float useAlpha, float selected) {
  vec4 color = map_color_s(cs, range, v, scaleType, useAlpha);
  if (selected > -0.5) {
    float selectionFactor = selected > 0.5 ? 1.0 : 0.2;
    color.a *= selectionFactor;
  }
  return color;
}
```

Add optional registration for colorscale-specific override GLSL:

```js
const colorscaleSelectionOverrides = new Map()  // name → glsl string

export function registerColorscaleSelectionOverride(name, glslFn) {
  // glslFn: string defining vec4 colorscale_sel_<name>(vec4 base, float selected)
  colorscaleSelectionOverrides.set(name, glslFn)
}
```

In `buildColorGlsl()`, if any overrides are registered, generate a dispatch function `map_color_s_sel_dispatch()` that checks the `cs` index and calls the override; falls back to the default.

### `src/core/LayerType.js` — selection column injection

In `createDrawCommand()`, after building color helpers, detect if the layer has a selection column:

```js
// After colorHelperLines loop
if (layer.selectionName) {
  const selCol = globalSelectionRegistry.get(layer.selectionName)
  if (selCol) {
    // Add selection texture uniform
    uniforms['u_sel_col'] = [() => globalSelectionRegistry.get(layer.selectionName)?._ref.texture]
    uniforms['u_sel_length'] = [() => globalSelectionRegistry.get(layer.selectionName)?._n ?? 0]

    // Inject sampler + sample in vertex shader
    vertSrc = injectInto(vertSrc, [`
      precision highp sampler2D;
      uniform sampler2D u_sel_col;
      uniform float u_sel_length;
    `])

    // Inject selection value computation into main()
    mainInjections.push(`float a_selection = u_sel_length > 0.5 ? sampleColumn(u_sel_col, a_pickId) : -1.0;`)

    // Pass as varying to fragment shader
    // (add "out float v_selection;" to vert decls, "in float v_selection;" to frag)
    // Replace map_color_* calls with map_color_s_sel variant
    // (transform fragSrc to replace generated map_color_X calls)
  }
}
```

Alternatively: inject `a_selection` as a varying and pass it to the fragment shader, where it modulates the colorscale output. This requires transforming the generated `map_color_*` wrapper calls in `fragSrc`. The cleanest approach: in `colorHelperLines`, conditionally generate `map_color_X` to call `map_color_s_sel` instead of `map_color_s` when selection is active.

```js
const useSelection = !!layer.selectionName
const colorFnBody = useSelection
  ? `return map_color_s_sel(colorscale${suffix}, color_range${suffix}, value, color_scale_type${suffix}, alpha_blend${suffix}, v_selection);`
  : `return map_color_s(colorscale${suffix}, color_range${suffix}, value, color_scale_type${suffix}, alpha_blend${suffix});`

colorHelperLines.push(
  `vec4 map_color_${fnSuffix(suffix)}(float value) {`,
  `  ${colorFnBody}`,
  `}`
)
```

---

## Phase 10 — Lasso Interaction Handler

### New file: `src/selection/LassoInteraction.js`

```js
export class LassoInteraction {
  constructor(plot, { selectionName, mode = 'lasso', trigger = 'shift' } = {}) {
    this._plot = plot
    this._selectionName = selectionName
    this._mode = mode        // 'lasso' | 'rect'
    this._trigger = trigger  // 'shift' | 'always' | 'ctrl'
    this._vertices = []
    this._active = false
    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp   = this._onMouseUp.bind(this)
    plot.canvas.addEventListener('mousedown', this._onMouseDown)
    plot.canvas.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
  }

  _shouldActivate(e) {
    if (this._trigger === 'shift') return e.shiftKey
    if (this._trigger === 'ctrl')  return e.ctrlKey || e.metaKey
    return true
  }

  _canvasPos(e) {
    const r = this._plot.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  _onMouseDown(e) {
    if (!this._shouldActivate(e)) return
    e.preventDefault()
    this._active = true
    this._vertices = [this._canvasPos(e)]
  }

  _onMouseMove(e) {
    if (!this._active) return
    const [x, y] = this._canvasPos(e)
    const last = this._vertices[this._vertices.length - 1]
    const dx = x - last[0], dy = y - last[1]
    if (dx * dx + dy * dy > 25) this._vertices.push([x, y])  // min 5px spacing
  }

  async _onMouseUp(e) {
    if (!this._active) return
    this._active = false
    if (this._vertices.length >= 3) {
      await this._plot.selectLasso(this._vertices)
    }
    this._vertices = []
  }

  destroy() {
    this._plot.canvas.removeEventListener('mousedown', this._onMouseDown)
    this._plot.canvas.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
  }
}
```

Visual lasso overlay (SVG):
- `Plot` exposes its SVG overlay element (`this.svg`)
- `LassoInteraction` draws a `<polyline>` on `mousemove` and removes it on `mouseup`
- No new infrastructure needed — use the existing SVG layer

---

## Phase 11 — Cross-plot Linked Selection

No new infrastructure needed beyond what Phase 2 provides. `SelectionRegistry.subscribe(name, plot)` and `.notify(name)` already propagate selection changes to all subscribed plots. 

Call `globalSelectionRegistry.subscribe(layerConfig.selection, this)` in `Plot._initialize()` (already noted in Phase 7). Any plot that renders a layer with `selection: "mySelection"` automatically re-renders when that selection updates.

---

## Declarative API (final shape)

```js
// Plot config
{
  layers: [
    {
      points: {
        xData: "input.x",
        yData: "input.y",
        color: "value",      // existing color axis
        selection: "brush1"  // new: names a SelectionColumn in SelectionRegistry
      }
    }
  ]
}

// Attach interaction (separate from config)
const lasso = new LassoInteraction(plot, { selectionName: "brush1", trigger: "shift" })

// Cross-plot: second plot subscribes to same selection name
// Any layer with selection: "brush1" automatically re-renders on change
```

---

## File Summary

| File | Status | Changes |
|---|---|---|
| `src/axes/AxisRegistry.js` | Modify | Export `buildSpatialGlsl()` |
| `src/core/LayerType.js` | Modify | Import `buildSpatialGlsl`; add `drawCount` command; add `u_idLo`/`u_idHi`; selection column injection |
| `src/core/Plot.js` | Modify | Extract `_buildLayerProps()`; add `selectLasso()`; register selection columns in `_initialize()`; resize hook |
| `src/core/Layer.js` | Modify | Add `selectionName` field; add `drawCount` draw function |
| `src/colorscales/ColorscaleRegistry.js` | Modify | Add `map_color_s_sel()`; optional per-colorscale override registry |
| `src/selection/SelectionColumn.js` | **New** | `TextureColumn` wrapping a regl FBO; `clear()` |
| `src/selection/SelectionRegistry.js` | **New** | `WeakMap<dataRef, Map<name, SelectionEntry>>`; per-plot GPU textures; CPU mirror; `notifyFromGpu()` cross-context propagation |
| `src/selection/LassoMask.js` | **New** | Polygon → mask FBO |
| `src/selection/PickCountFbo.js` | **New** | Pick FBO + count FBO; range-limited render |
| `src/selection/GatherPass.js` | **New** | Point-sprite scatter-write into selection texture |
| `src/selection/SelectionPipeline.js` | **New** | Halving loop orchestration |
| `src/selection/LassoInteraction.js` | **New** | Mouse event handler; SVG overlay |
| `src/index.js` | Modify | Export new public types |

## Implementation Order

Implement in this order to allow testing at each step:

1. Phase 1 (extract GLSL) — verify rendering unchanged
2. Phase 2 (SelectionColumn + Registry) — unit test texture layout
3. Phase 3 (LassoMask) — visually verify polygon FBO with a debug render
4. Phase 4 (PickCountFbo + `drawCount`) — verify count FBO with a debug overlay
5. Phase 5 (GatherPass) — verify single-covered pixels write correct selection values
6. Phase 6 (SelectionPipeline) — end-to-end test with small N (100 points), verify all selected
7. Phase 7 (Plot.js integration) — wire up `selectLasso()`
8. Phase 8 (Layer.selectionName)
9. Phase 9 (colorscale variant) — verify visual dimming of unselected
10. Phase 10 (LassoInteraction) — interactive test
11. Phase 11 (cross-plot) — multi-plot test
