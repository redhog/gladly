# Tiled Data

## Overview

Any `ColumnData` column can produce **N tiles** of data. A layer whose attributes
include tiled columns is rendered as **N sequential draw calls** — one per tile —
using the same compiled shader but different GPU bindings each time.  Tile count
N = 1 produces exactly one draw call, identical to the pre-tiling behaviour.

---

## API Changes

### `ColumnData.resolve(path, regl)`

Return type changes from:
```js
{ glslExpr: string, textures: { uniformName: () => texture } }
```
to:
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

Return type changes from `texture` to `texture[]`.  A single-tile column returns
`[texture]`.  A tiled column returns one texture per tile.

`GlslColumn.toTexture()` detects tiling from its input textures, runs one GPU
render pass per tile, and returns `texture[]`.

---

## Buffer Attribute Tiling

A `_createLayer` gpuConfig attribute value may be `Float32Array[]` (one typed
array per tile) instead of a plain `Float32Array`.  Tiled buffer attributes drive
per-tile GPU buffer bindings, per-tile vertex counts, and per-tile `a_pickId`
arrays.

---

## Tile-Count Rules

All tiled things in **one layer** must agree on N.  Concretely:

* Every `fn[]` value across all resolved texture columns must have the same length.
* Every `Float32Array[]` attribute must have the same length.
* The above must also agree with each other.

Validation happens inside `LayerType.createDrawCommand`; a mismatch throws.

A non-tiled column (`fn[]` of length 1, or a plain `Float32Array`) is simply
a special case of N = 1 — it is not "broadcast" to match a larger N.  All
columns in a layer must share the same N.

---

## Render Loop

`_compileLayerDraw` returns a draw function that loops over N tiles:

```
for t in 0..N-1:
    bind tile-t textures for every tiled uniform
    bind tile-t GPU buffer for every tiled buffer attr + a_pickId
    call compiled shader with per-tile count (or runtimeProps.count if no buffer tiling)
```

No `regl.clear` is issued between tiles — each tile's geometry is drawn on top
of the previous tile, giving a seamless merged result.

---

## Compute Files

`hist`, `kde`, `filter*`, `elementwise`, and `fftConvolution` always produce a
single output tile.  Where they call `inputCol.toTexture(regl)` they now take
`[0]` from the returned array.  A tiled column passed as input to these
computations silently uses only tile 0.  Computations that wish to propagate
tiling across all tiles must do so explicitly.
