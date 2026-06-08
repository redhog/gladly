# Selection — Architecture

The GPU-driven lasso selection pipeline finds **all** data points inside the drawn region, including occluded ones. It runs in two passes entirely in data space — no depth buffer, no pixel-space halving. For the user-facing API see [Selection — User API](../user-api/Selection.md). For the configuration key see [Selection — Configuration](../configuration/Selection.md).

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| `SelectionColumn` | `src/selection/SelectionColumn.js` | Holds one float FBO per data tile; 4-packed per texel; `upload(flat)` splits a flat CPU buffer across tile textures; `_rebuild(tileSizes)` reallocates tiles when tile structure changes |
| `SelectionRegistry` | `src/selection/SelectionRegistry.js` | `WeakMap<dataRef, Map<name, entry>>` — allocates and owns one `SelectionColumn` per (dataRef, name) pair (shared across all plots using the same data + name); sets `col._onWrite` to call `scheduleRender()` on every consumer plot; no copy-propagation logic |
| `Selection` | `src/selection/Selection.js` | User-facing wrapper for one (dataRef, plot, name) triple; implements `ColumnData`; owns the per-tile CPU mirror (`_arrays: Float32Array[] | null`); fires subscribers on change |
| `SelectionLink` | `src/selection/SelectionLink.js` | `linkSelections(selA, selB)` — wires two `Selection` objects bidirectionally via their `subscribe` APIs |
| `LassoMask` | `src/selection/LassoMask.js` | SVG polyline overlay drawn while the user drags; no role in the GPU pipeline |
| `PositionCapture` | `src/selection/PositionCapture.js` | Pass 1 — runs the layer's vertex shader in capture mode, scatter-writing NDC positions into a float FBO |
| `SelectionTestPass` | `src/selection/SelectionTestPass.js` | Pass 2 — instanced draw, one instance per primitive; reads positions from Pass 1 FBO, tests against lasso polygon, scatter-writes into one `SelectionColumn` tile |
| `SelectionPipeline` | `src/selection/SelectionPipeline.js` | Orchestrates the two passes per layer per tile; converts lasso vertices to NDC |
| `LassoInteraction` | `src/selection/LassoInteraction.js` | Mouse event handler; drives `LassoMask` overlay; calls `plot.selectLasso()` on mouseup |

---

## Two-Pass Algorithm (per tile)

Both passes work entirely in **data space**. For tiled layers the two passes run once per tile. All N primitives within a tile are processed in two passes regardless of overlap on screen.

### Pass 1 — Position Capture

The layer's own vertex shader runs in capture mode (`u_mode = 1.0`). Instead of drawing to the screen, each invocation scatter-writes its computed **NDC screen position** and **local pick ID** into a float RGBA position FBO — one texel per primitive within the tile:

```
Data attributes → [same vertex shader + axis/zoom/pan transform, u_mode=1,
                   u_tile_pick_offset=0] → per-tile Position FBO
                                           texel i = (ndcX, ndcY, localPickId, endPoint)
```

Setting `u_tile_pick_offset = 0` forces `global_pick_id = a_pickId` (the local index), so each vertex lands at its tile-local position in the FBO. The FBO is sized for `tile.n` entries, not the total across all tiles.

For instanced layers (e.g. `LinesLayer`), Pass 1 runs **twice** per tile — once with `u_capture_endpoint = 0.0` and once with `u_capture_endpoint = 1.0` — producing separate position FBOs for segment start and end points.

### Pass 2 — Selection Test

An instanced draw renders `tile.n` point sprites, one per primitive in the tile. Each instance:

1. Reads its NDC position from the Pass 1 FBO.
2. Tests the primitive against the lasso polygon.
   - **Points**: winding-number point-in-polygon test.
   - **Segments**: either endpoint inside the lasso, OR any lasso edge crosses the segment.
3. If selected, scatter-writes `1.0` into the correct texel and channel of the **tile's own** `SelectionColumn` FBO.

```
per-tile Position FBO + lasso texture → [per-primitive test] → selCol._tiles[t].fbo
```

Because neither pass uses a depth buffer, every primitive is processed exactly once regardless of overlap. Because tiles are independent, the two passes scale to any number of tiles with no cross-tile interference.

---

## Per-Tile Selection Textures

`SelectionColumn` stores one float RGBA FBO per data tile, each sized independently:

```
selCol._tiles[t] = { texture, fbo, texW, texH, n }
```

In the vertex shader, `u_sel_col` is a **tiled uniform** (a Proxy `fn[]`) that is rebound to `_tiles[t].texture` during tile draw call `t`, exactly like any other tiled data column. `sampleColumn(u_sel_col, a_pickId)` uses the local pick ID and the tile-local selection texture.

The 4-per-texel packing matches all other data textures: data point `i` within a tile is stored at texel `floor(i/4)`, channel `mod(i, 4)`.

---

## Dynamic Tile Structure

Tile count and sizes can change between renders (e.g. when new tiled data arrives over the network). The framework rebuilds selection tiles automatically in two places:

1. **Every render frame** — after the tile loop computes `layer._tileSizes`, it checks whether `selCol._tiles` matches. If not, `selCol._rebuild(layer._tileSizes)` destroys the old FBOs and allocates new ones. `_rebuild` calls `selCol._onClear`, which `Selection` registers to null `_arrays` and notify subscribers.

2. **Every lasso** — `SelectionPipeline.runLasso()` performs the same check before its GPU passes, in case tile count changed since the last render frame.

---

## Scatter-Write Packing

Each `SelectionColumn` tile stores 4 values per texel (RGBA), matching the packing used by all data textures in Gladly. The scatter-write helper in the Pass 2 vertex shader positions each `gl.POINTS` sprite at the texel corresponding to `floor(pickId / 4.0)`, and the fragment shader writes only the channel `mod(pickId, 4.0)` as `1.0`, leaving the others `0.0`. Additive blending accumulates multiple writes into the same texel without conflict.

---

## Propagation Flow

After `SelectionPipeline.runLasso()` completes, `Plot.selectLasso()` calls `selection._readbackAndNotify()` on each affected `Selection` object:

1. **GPU readback** — reads each tile's FBO into a `Float32Array` trimmed to `tile.n`, storing the result as `_arrays: Float32Array[]` (one per tile). If no points are selected, the column is cleared and `_arrays` is set to `null`.
2. **`_onClear` registration** — `_readbackAndNotify` registers a callback on `selCol._onClear` so that any future tile rebuild (e.g. new data mid-session) automatically nulls `_arrays` and notifies subscribers.
3. **`selCol._onWrite` fires** — because the `SelectionColumn` is shared (same (dataRef, name) pair → same column instance), writing it via `upload()` or `clear()` calls `selCol._onWrite()`, which `SelectionRegistry` has wired to call `scheduleRender()` on **every consumer plot**. This means all plots that reference this column re-render without explicit cross-plot wiring.
4. **`selection._notify()`** — fires all registered subscribers with the `Selection` as argument.
5. **Linked plot update** (if `linkSelections` was called) — the subscriber calls `otherSelection.applyFrom(selection)`, which syncs tile structure, uploads `_arrays` to per-tile GPU textures, schedules re-render, and notifies its own subscribers.
6. **`otherSelection._notify()`** — fires the other selection's subscribers. A `_propagating` flag breaks cycles.

```
selectLasso()
  └─ SelectionPipeline.runLasso()             [GPU: 2-pass per tile → per-tile SelectionColumn FBOs]
  └─ Selection._readbackAndNotify()
       └─ per-tile GPU readback → _arrays: Float32Array[]
       └─ col.activate() / col.clear()
       │    └─ col._onWrite() → SelectionRegistry callback
       │         └─ for each consumer plot: plot.scheduleRender()   ← all sharing plots re-render
       └─ col._onClear = () => { _arrays=null; notify }
       └─ _notify() → subscribers
            └─ otherSelection.applyFrom(selection)   [if linkSelections used]
                 └─ selCol._rebuild() if tile structure differs
                 └─ col.upload(_arrays)        [GPU: per-tile Float32Array[] → per-tile subimages]
                 │    └─ col._onWrite() → SelectionRegistry callback (scheduleRender on all)
                 └─ _notify() → …
```

Cross-plot re-renders happen automatically via `selCol._onWrite` because the `SelectionColumn` instance is shared — all plots using the same (dataRef, name) pair reference the same column. Explicit copy-propagation of `_arrays` state is still established via `linkSelections(selA, selB)` or `PlotGroup._updateAutoLinks()` when `autoLink: true`, matching on **both the dataset object reference and the selection name**.

---

## Limitations

- **Lasso vertex limit**: the lasso polygon is uploaded as a float texture (width = N vertices); in practice `LassoInteraction` enforces a minimum 5 px spacing between recorded vertices to keep N reasonable.
- **Transformed layers**: layers driven by histogram/KDE/FFT have a different N from the raw data. They cannot be directly selected; they consume a `SelectionColumn` as a computation input instead.
- **Cross-context GPU readback**: `_readbackAndNotify()` uses `regl.read()` which requires `EXT_color_buffer_float`. This extension is requested at context creation and is widely supported in WebGL 2. If unavailable, readback silently fails and only the source plot's own render updates.
