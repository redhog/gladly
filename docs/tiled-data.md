# Tiled Data

## Overview

Any `ColumnData` column can produce **N tiles** of data. A layer whose attributes
include tiled columns is rendered as **N sequential draw calls** — one per tile —
using the same compiled shader but different GPU bindings each time.  Tile count
N = 1 produces exactly one draw call.

---

## Column API

### `ColumnData.resolve(path, regl)`

Returns:
```js
{ glslExpr: string, textures: { uniformName: [() => texture, ...] } }
```

`textures` values are **always arrays** of zero-arg functions returning a regl
texture.  A single-tile column returns an array of length 1.  `glslExpr` is
**always a single string** — it never changes per tile.  The same GLSL expression
is used for every draw call; only the texture bound to the sampler uniform changes.

**`GlslColumn`** propagates tiling automatically: `Object.assign` merges input
texture dicts whose values are already `fn[]`; the `glslExpr` produced by the
user-supplied function is unchanged.

**`OffsetColumn`** likewise requires no changes — it passes `textures` through
and only mutates the `glslExpr` string.

### `ColumnData.toTexture(regl)`

Returns `texture[]` — one regl texture per tile.  A single-tile column returns
`[texture]`.

`GlslColumn.toTexture()` detects tiling from its input textures, runs one GPU
render pass per tile, and returns `texture[]`.

---

## Buffer Attribute Tiling

A `_createLayer` gpuConfig attribute value may be a plain `Float32Array` (single
tile, wrapped internally to `[Float32Array]`) or `Float32Array[]` (one typed array
per tile).  Both produce `{ kind: 'buffer-tiled', values }` inside
`resolveAttributeExpr`.  Tiled buffer attributes drive per-tile GPU buffer
bindings, per-tile vertex counts, and per-tile `u_tile_pick_offset` values.

Tiles in a `Float32Array[]` attribute **may have different lengths** — the tile
loop uses each tile's own array length as the vertex count for that draw call.

---

## Tile-Count Rules

All tiled things in **one layer** must agree on N.  Concretely:

* Every `fn[]` value across all resolved texture columns must have the same length.
* Every buffer attribute that is `Float32Array[]` must have the same array count.
* The above must also agree with each other.

Validation happens inside `LayerType.createDrawCommand`; a mismatch throws.

N = 1 is not a special case — it is simply a layer with one tile.  All
columns in a layer must share the same N.

---

## Render Loop

`_compileLayerDraw` returns a draw function that loops over N tiles:

```
for t in 0..N-1:
    bind tile-t textures for every tiled uniform
    bind tile-t GPU buffer for every tiled buffer attr
    set u_tile_pick_offset = cumulative pick offset for tile t
    set count = tile-t vertex count (for tiled buffer attrs) or runtimeProps.count
    call compiled shader
```

No `regl.clear` is issued between tiles — each tile's geometry is drawn on top
of the previous tile, giving a seamless merged result.

---

## Pick IDs and Tile Identification

`a_pickId` is always a **single shared buffer** (0 .. N-1) regardless of tiling.
It is used for texture sampling (`sampleColumn`) which is tile-local.

The pick colour written to the framebuffer uses the **global pick ID**:

```glsl
float global_pick_id = a_pickId + u_tile_pick_offset;
v_pickId = global_pick_id;
```

`u_tile_pick_offset` is set per tile by the render loop:

| Tile kind | Offset for tile t |
|-----------|-------------------|
| Texture tiles (uniform N per tile) | `t × N` |
| Buffer-array tiles | cumulative sum of `tile[0].length + … + tile[t-1].length` |

After each draw the render loop stores the per-tile offset table on
`layer._tilePickOffsets` (an array of length N, one entry per tile).
`plot.pick()` uses this table to automatically decode the global pick ID back into
`{ tile, index }` — **no manual decoding is required by callers.**

The same global pick ID is used in the capture texture for lasso selection, so
selection works correctly across all tiles.

---

## Selections

Lasso selection is **fully tile-aware** — `SelectionColumn` holds one GPU
texture per tile, each sized for that tile's vertex count.  The lasso pipeline
runs two passes per tile rather than across the whole layer at once.

### Per-tile selection textures

`SelectionColumn._tiles` is an array of `{ texture, fbo, texW, texH, n }` objects,
one per tile.  In the vertex shader the `u_sel_col` uniform is rebound to
tile `t`'s texture during tile draw call `t`, exactly like any other tiled
column attribute.  `sampleColumn(u_sel_col, a_pickId)` therefore uses the
**local** pick ID (0..tile.n-1) and the tile-local selection texture — no
global offset is needed.

### Dynamic tile structure

The number and sizes of selection tiles are not fixed at layer creation time.
Tile sizes can change between renders when tiled data arrives over the network.
The framework handles this in two places:

1. **Render loop** — after computing `layer._tileSizes` each frame, the tile
   loop checks whether `selCol._tiles` matches.  If not, it calls
   `selCol._rebuild(layer._tileSizes)`, which destroys the old FBOs, allocates
   fresh ones, and fires `selCol._onClear` so `Selection` can null its cached
   CPU data and notify subscribers.

2. **Lasso time** — `SelectionPipeline.runLasso()` performs the same check
   immediately before the GPU passes, in case tile count changed since the
   last render.

### Lasso pipeline (per tile)

For each layer with a selection binding, `SelectionPipeline.runLasso()` iterates
`selCol._tiles` and for each tile `t`:

1. Calls `captureDrawCmd` with `{ _tileOnly: t, _captureTileOffset: 0 }`.
   - `_tileOnly: t` — the tile loop skips all tiles except `t`.
   - `_captureTileOffset: 0` — forces `u_tile_pick_offset = 0` so the
     capture vertex shader uses `global_pick_id = a_pickId + 0 = a_pickId`
     (local index).  The position FBO is sized for `tile.n` entries, and
     each vertex lands at its local position.
2. Runs `SelectionTestPass` writing results into `selCol._tiles[t].fbo`.

### CPU readback and `selection.arrays`

After the pipeline, `Selection._readbackAndNotify()` reads each tile's FBO
separately into its own `Float32Array`, trimmed to `tile.n` values.
`selection.arrays` is a `Float32Array[] | null` — one array per tile, mirroring
how `toTexture()` returns `texture[]`.  `selection.arrays[t][i]` is `1` when
local point `i` within tile `t` is selected, `0` otherwise.
`selection.length` returns the total count across all tiles.

---

## Compute Files

`hist`, `kde`, `filter*`, `elementwise`, and `fftConvolution` always produce a
single output tile.  Where they call `inputCol.toTexture(regl)` they now take
`[0]` from the returned array.  A tiled column passed as input to these
computations silently uses only tile 0.  Computations that wish to propagate
tiling across all tiles must do so explicitly.
