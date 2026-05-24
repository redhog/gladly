# Selection — Architecture

The GPU-driven lasso selection pipeline finds **all** data points inside the drawn region, including occluded ones. It runs in two passes entirely in data space — no depth buffer, no pixel-space halving. For the user-facing API see [Selection — User API](../user-api/Selection.md). For the configuration key see [Selection — Configuration](../configuration/Selection.md).

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| `SelectionColumn` | `src/selection/SelectionColumn.js` | Float texture FBO storing 0/1 selection values, 4-packed per texel; `upload(packed)` pushes a CPU buffer to the GPU texture |
| `SelectionRegistry` | `src/selection/SelectionRegistry.js` | `WeakMap<dataRef, Map<name, entry>>` — allocates and owns one `SelectionColumn` per (plot, name) pair; no propagation logic |
| `Selection` | `src/selection/Selection.js` | User-facing wrapper for one (plot, name) pair; implements `ColumnData`; owns the CPU mirror (`_packed`); fires subscribers on change |
| `SelectionLink` | `src/selection/SelectionLink.js` | `linkSelections(selA, selB)` — wires two `Selection` objects bidirectionally via their `subscribe` APIs |
| `LassoMask` | `src/selection/LassoMask.js` | SVG polyline overlay drawn while the user drags; no role in the GPU pipeline |
| `PositionCapture` | `src/selection/PositionCapture.js` | Pass 1 — runs the layer's vertex shader in capture mode, scatter-writing NDC positions into a float FBO |
| `SelectionTestPass` | `src/selection/SelectionTestPass.js` | Pass 2 — instanced draw, one instance per primitive; reads positions from Pass 1 FBO, tests against lasso polygon, scatter-writes into `SelectionColumn` |
| `SelectionPipeline` | `src/selection/SelectionPipeline.js` | Orchestrates the two passes per layer; converts lasso vertices to NDC |
| `LassoInteraction` | `src/selection/LassoInteraction.js` | Mouse event handler; drives `LassoMask` overlay; calls `plot.selectLasso()` on mouseup |

---

## Two-Pass Algorithm

Both passes work entirely in **data space**. All N primitives are processed in a fixed two passes regardless of overlap on screen.

### Pass 1 — Position Capture

The layer's own vertex shader runs in capture mode (`u_mode = 1.0`). Instead of drawing to the screen, each invocation scatter-writes its computed **NDC screen position** and **pick ID** into a float RGBA position FBO — one texel per primitive:

```
Data attributes → [same vertex shader + axis/zoom/pan transform, u_mode=1] → Position FBO
                                                                 texel i = (ndcX, ndcY, pickId, endPoint)
```

For instanced layers (e.g. `LinesLayer`, which renders segments as 2-vertex instances), Pass 1 runs **twice** — once with `u_capture_endpoint = 0.0` and once with `u_capture_endpoint = 1.0` — producing separate position FBOs for segment start and end points.

The capture branch is injected into every vertex shader by `LayerType.createDrawCommand()`. All normal render calls pass `u_mode = 0.0` and the branch is never entered.

### Pass 2 — Selection Test

An instanced draw renders `N` point sprites (one per primitive) using `gl_InstanceID` to index into the Pass 1 FBO(s) via `texelFetch`. Each instance:

1. Reads its NDC position (and for lines, its partner endpoint position).
2. Tests the primitive against the lasso polygon supplied as a float texture (`lassoTex`, width = N vertices).
   - **Points**: winding-number point-in-polygon test.
   - **Segments**: either endpoint inside the lasso, OR any lasso edge crosses the segment.
3. If selected, scatter-writes `1.0` into the correct texel and channel of the `SelectionColumn` FBO.

```
Position FBO(s) + lasso texture → [per-primitive test, instanced draw] → SelectionColumn FBO
```

Because neither pass uses a depth buffer, every primitive is processed exactly once regardless of overlap.

---

## Scatter-Write Packing

`SelectionColumn` stores 4 values per texel (RGBA), matching the packing used by all data textures in Gladly. The scatter-write helper in the Pass 2 vertex shader positions each `gl.POINTS` sprite at the texel corresponding to `floor(pickId / 4.0)`, and the fragment shader writes only the channel `mod(pickId, 4.0)` as `1.0`, leaving the others `0.0`. Additive blending accumulates multiple writes into the same texel without conflict.

---

## Propagation Flow

After `SelectionPipeline.runLasso()` completes, `Plot.selectLasso()` calls `selection._readbackAndNotify()` on each affected `Selection` object:

1. **GPU readback** — reads the `SelectionColumn` FBO into a `Float32Array` (`selection._packed`, `texW×texH×4` elements). If no points are selected the column is cleared and `_packed` is set to `null`.
2. **`selection._notify()`** — fires all registered subscribers with the `Selection` as argument.
3. **Linked plot update** (if `linkSelections` was called) — the subscriber calls `otherSelection._applyFromCpu(selection._packed)`, which uploads the packed buffer to the other plot's `SelectionColumn` GPU texture and schedules its re-render.
4. **`otherSelection._notify()`** — fires the other selection's own subscribers, enabling chains (A → B → C). A `_propagating` flag on each `Selection` breaks cycles.

```
selectLasso()
  └─ SelectionPipeline.runLasso()          [GPU: 2-pass write into SelectionColumn FBO]
  └─ Selection._readbackAndNotify()
       └─ GPU readback → _packed
       └─ col.activate() / col.clear()
       └─ plot.scheduleRender()
       └─ _notify() → subscribers
            └─ otherSelection._applyFromCpu(_packed)
                 └─ col.upload(packed)     [GPU: subimage into other plot's SelectionColumn]
                 └─ plot.scheduleRender()
                 └─ _notify() → …
```

Cross-plot links are established either manually via `linkSelections(selA, selB)` or automatically by `PlotGroup._updateAutoLinks()` when `autoLink: true`.

---

## Limitations

- **Lasso vertex limit**: the lasso polygon is uploaded as a float texture (width = N vertices); in practice `LassoInteraction` enforces a minimum 5 px spacing between recorded vertices to keep N reasonable.
- **Transformed layers**: layers driven by histogram/KDE/FFT have a different N from the raw data. They cannot be directly selected; they consume a `SelectionColumn` as a computation input instead.
- **Cross-context GPU readback**: `_readbackAndNotify()` uses `regl.read()` which requires `EXT_color_buffer_float`. This extension is requested at context creation and is widely supported in WebGL 2. If unavailable, readback silently fails and only the source plot's own render updates.
