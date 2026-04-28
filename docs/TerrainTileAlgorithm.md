# Terrain Tile Loading and Rendering Algorithm

## Problem Statement

A terrain layer renders 3D meshes textured with elevation (DTM) and satellite imagery. Tiles exist in
a quad-tree pyramid: zoom level `z` has `2^z × 2^z` tiles, each tile at `z` covering the same area
as exactly 4 tiles at `z+1`. In slippy-map convention tile `(z, x, y)` has:

- Parent: `(z-1, x>>1, y>>1)`
- Children: `(z+1, 2x, 2y)`, `(z+1, 2x+1, 2y)`, `(z+1, 2x, 2y+1)`, `(z+1, 2x+1, 2y+1)`

Two tiles overlap in geographic space if and only if one is an ancestor of the other.

Unlike a 2D raster layer — where a child tile simply overwrites a parent tile on screen — a 3D
terrain mesh has actual depth. If a parent tile and a child tile are both rendered they occupy the
same region of 3D space at slightly different elevations, causing Z-fighting and visual corruption.
The rendering algorithm must guarantee **no ancestor-descendant pair is ever rendered simultaneously**.

---

## Terminology

| Term | Meaning |
|------|---------|
| **target tiles** | The set of tiles at the optimal zoom level that covers the current viewport |
| **needed set** | Same as target tiles — what we want to load |
| **render set** | What we actually draw this frame — a subset of loaded tiles with no overlaps |
| **ancestor fallback** | A loaded tile at `z-k` shown in place of an unloaded target tile |

---

## Algorithm A — Single Zoom Level, Strict

**Render set**: only loaded tiles whose key is in the current needed set.

```
neededKeys = computeTargetTiles(viewport, optimalZoom)
renderSet  = { t ∈ loadedTiles | t.key ∈ neededKeys }
```

**Pros**: trivially no overlap; simple to reason about.  
**Cons**: every zoom change or large pan blanks the terrain until new tiles arrive. Because terrain
tiles contain heavy GPU buffers (position textures, DTM textures) they can take seconds to load.

**When it fails**: this is the current state. The missing piece was that `_rebuildArrays` was not
called when `_neededKeys` changed without new tiles loading, causing previously-needed tiles to
remain visible and overlap with new ones.

---

## Algorithm B — Nearest Ancestor Fallback with Sub-mesh Cut-out (Recommended)

For each target tile not yet loaded, walk up the ancestor chain until a loaded tile is found.
Rather than showing the whole ancestor tile (which would overlap other loaded tiles), **cut out
only the portion of the ancestor mesh that geographically corresponds to the missing target tile**
and render that sub-mesh alone.

### No-overlap guarantee

Each target tile slot produces exactly one render item: either the target tile itself (full mesh),
or one sub-mesh of an ancestor (covering only that slot's geographic footprint). Because sub-meshes
of the same ancestor cover disjoint geographic sub-regions, and the target tile and its ancestor
sub-mesh are mutually exclusive, **no two render items ever overlap**. No `covered` set is needed.

### Sub-mesh geometry

Ancestor at `(z-k, ax, ay)` covers target tile `(z, x, y)` where:

```
stride = 2^k
qx    = x - ax * stride    // column offset within ancestor (0 … stride-1)
qy    = y - ay * stride    // row offset within ancestor    (0 … stride-1)
```

The ancestor has a tessellation grid of `N × N` quads (`(N+1) × (N+1)` vertices). The sub-mesh
for this target tile uses:

- **Vertex rows**: `j ∈ [ qy·N/stride , (qy+1)·N/stride ]`  (inclusive)
- **Vertex cols**: `i ∈ [ qx·N/stride , (qx+1)·N/stride ]`  (inclusive)
- **DTM UV range**: `u ∈ [ qx/stride , (qx+1)/stride ]`, `v ∈ [ qy/stride , (qy+1)/stride ]`
- **Position (x_pos, z_pos)**: subset of the ancestor's position arrays — already correct because
  positions are computed from geographic coordinates which naturally fall within the sub-region.
- **Satellite UV**: computed per-vertex from geographic sat coordinates, correct automatically.

`N` must be divisible by `stride`. For `N = 16` and `maxFallback = 4` (stride up to 16), each
vertex is the minimum granularity; all values still yield valid (if coarse) sub-meshes.

### Pseudocode

```
function buildRenderItems(neededSpecs, tileCache, maxFallback = 4):
  items = []   // list of RenderItem = { slot, vertRowStart, vertRowEnd, vertColStart, vertColEnd,
               //                        dtmUvOffset: [ux,uy], dtmUvScale: [sx,sy] }

  for spec in neededSpecs:           // spec = { key, z, x, y }
    tile = tileCache.get(spec.key)
    if tile is loaded:
      items.push({ slot: tile.slot,
                   vertRowStart: 0, vertRowEnd: N,
                   vertColStart: 0, vertColEnd: N,
                   dtmUvOffset: [0, 0], dtmUvScale: [1, 1] })
      continue

    // Walk ancestors
    found = false
    for k = 1 to maxFallback:
      az = spec.z - k
      if az < 0: break
      ax   = spec.x >> k
      ay   = spec.y >> k
      aKey = "${az}/${ax}/${ay}"
      ancestor = tileCache.get(aKey)
      if ancestor is loaded:
        stride = 1 << k
        qx = spec.x - ax * stride
        qy = spec.y - ay * stride
        items.push({
          slot:         ancestor.slot,
          vertRowStart: qy * N / stride,
          vertRowEnd:   (qy + 1) * N / stride,
          vertColStart: qx * N / stride,
          vertColEnd:   (qx + 1) * N / stride,
          dtmUvOffset:  [qx / stride, qy / stride],
          dtmUvScale:   [1 / stride,  1 / stride],
        })
        found = true
        break

    // If !found: blank area for this target tile (acceptable)

  return items
```

### Rendering a sub-mesh item

Given a `RenderItem`, the draw call uses only the triangles whose both row and column indices fall
within `[vertRowStart, vertRowEnd) × [vertColStart, vertColEnd)`. In the flat triangle-list layout
used by the current code, this means selecting a contiguous sub-range of the `vertexCount` triangles.

For a full tile the flat list has `N × N × 6` elements (6 per quad). For a sub-mesh spanning
`rH = vertRowEnd - vertRowStart` rows and `rW = vertColEnd - vertColStart` cols, the sub-mesh has
`rH × rW × 6` elements. Their flat indices (in the ancestor's triangle list) are **not contiguous**
because the outer loop is over rows of the full `N`-wide grid. Two implementation options:

**Option 1 — Re-pack at cut time (simpler):** When a sub-mesh is first needed, extract the relevant
vertex data from the ancestor's CPU arrays (`xArr`, `zArr`, `satXArr`, `satYArr`) and the DTM UV
buffer into a new set of GPU textures, and build a new `dtmUvs` buffer with the adjusted UV range.
Store these per `(ancestorKey, qx, qy, k)` in a sub-mesh cache inside the tile slot.

**Option 2 — Index buffer:** Build an index buffer that selects only the triangles in the sub-range
from the ancestor's shared position textures. Requires regl index-buffer support.

Option 1 is recommended for simplicity. The sub-mesh cache is keyed by `(qx, qy, k)` within the
tile slot and is populated lazily (first time that sub-region is needed) and cleared when the tile
is evicted.

### Loading ancestor tiles

Ancestor tiles must be in cache to serve as fallbacks. **Retained previous zoom** is the preferred
strategy: do not evict tiles simply because they left `_neededKeys`. Evict only when the cache is
full (LRU). This preserves tiles from the previous zoom level as natural fallback ancestors for the
new zoom, without any extra HTTP requests.

### What the `_neededKeys` set should contain

`_neededKeys` governs what is **requested for loading** (HTTP) — target zoom tiles only, as at
present. The render items are computed separately each frame from what is already in cache.
Keeping these two concerns separate was the key insight missing from earlier implementations.

---

## Comparison

| Property | A (Strict) | B (Cut-out ancestor) |
|----------|-----------|----------------------|
| No overlap guarantee | ✓ | ✓ (by construction, no `covered` set needed) |
| Smooth zoom | ✗ (blanks) | ✓ (ancestor sub-mesh shown) |
| Seamless per-tile coverage | ✗ | ✓ (ancestor cut to exact footprint) |
| Resolution during fallback | — | Lower (ancestor zoom level) |
| Implementation complexity | Low | Medium |
| Memory overhead | Low | Low–medium (sub-mesh cache per tile) |
| Extra HTTP requests | None | None (retained previous zoom) |

---

## Key invariants to maintain in implementation

1. **`_neededKeys`** = tiles we want to load (target zoom only). Drive HTTP requests.
2. **Render items** = computed fresh from loaded tiles using Algorithm B. Drive GPU draw.
3. **Cache eviction** = LRU by access time up to `MAX_TILE_CACHE`. Never evict based on
   `_neededKeys` alone — stale tiles are valuable ancestors.
4. **No two render items cover overlapping geographic area** — guaranteed by the one-item-per-
   target-tile-slot structure of Algorithm B.
5. **`_rebuildArrays`** = always rebuilds render items; called whenever any tile status changes
   (load, evict) and whenever `_neededKeys` changes (domain shift).
