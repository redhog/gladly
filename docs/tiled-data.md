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

## Compute Files

`hist`, `kde`, `filter*`, `elementwise`, and `fftConvolution` always produce a
single output tile.  Where they call `inputCol.toTexture(regl)` they now take
`[0]` from the returned array.  A tiled column passed as input to these
computations silently uses only tile 0.  Computations that wish to propagate
tiling across all tiles must do so explicitly.
