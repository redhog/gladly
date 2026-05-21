# Plan: Categorical Columns and Categorical Filter Axis

## Overview

Add support for categorical data columns and a corresponding categorical filter axis. A categorical filter axis renders as a set of checkboxes (one per category) rather than the existing range brush. The implementation is split into three parts: column metadata, categorical filter axis, and the Filterbar UI widget.

---

## Part 1: Column Metadata Subsystem

### Motivation

Categorical is not a distinct column subtype — any `ColumnData` (ArrayColumn, TextureColumn, GlslColumn, OffsetColumn, …) can hold categorical data. Annotations are metadata attached to a column instance, not encoded in the type hierarchy.

### Changes to `ColumnData` base class (`src/compute/ComputationRegistry.js`)

- Add `.metadata = {}` property to the base class constructor.
- Add `.withMetadata(dict)` method:
  - Returns a new instance of the same class with metadata deep-merged (`dict` wins on conflicts).
  - Deep merge: for each key, if both existing and incoming values are plain objects (`typeof v === 'object' && v !== null && !Array.isArray(v)`), recurse; otherwise incoming value replaces existing.

### Metadata propagation in derived columns

| Column type | Propagation rule |
|---|---|
| `OffsetColumn` | Copy source column's metadata at construction (`this.metadata = deepMerge({}, source.metadata)`) |
| `TextureColumn` (from `toTexture()`) | Copy source column's metadata |
| `GlslColumn` | **No** automatic propagation from inputs; caller supplies explicit `metadata` parameter at construction |
| `ArrayColumn` | No source to propagate from; starts with `{}` |

### Categorical metadata shape

```js
{
  type: 'categorical',
  categories: ['label0', 'label1', 'label2', ...]  // index = category ID
}
```

Category IDs are integers stored as floats in the column data. Float32 represents integers exactly up to 2^24, sufficient for all practical category counts.

---

## Part 2: Categorical Filter Axis

### Dispatch in `FilterAxisRegistry`

When a layer's `filter` attribute is resolved to a column, `FilterAxisRegistry` inspects `column.metadata?.type`:

- `=== 'categorical'` → create `CategoricalFilterAxis`
- otherwise → existing `RangeFilterAxis` (no change)

### `CategoricalFilterAxis`

**Construction:**
- Reads `column.metadata.categories` for label list.
- Determines tier from `categories.length` (fixed at construction, never upgraded).
- Initialises `checkedSet = new Set(categories.map((_, i) => i))` — all shown by default.

**Tier selection:**

| Category count | Tier | GPU mechanism |
|---|---|---|
| 1 – 32 | 1 | Single `uint` uniform; bit `i` = category `i` checked |
| 33 – 1024 | 2 | `uint[]` uniform array, `ceil(N/32)` words, packed bitmask |
| 1025+ | 3 | 1D regl texture, 4-packed RGBA (same convention as data textures), value `1.0`/`0.0` per slot |

**GLSL predicate generation** (injected by `FilterAxisRegistry` like existing range predicates):

*Tier 1:*
```glsl
uniform uint u_catFilter_<name>;
bool <name>_passes = ((u_catFilter_<name> >> uint(<categoryExpr>)) & 1u) == 1u;
```

*Tier 2:*
```glsl
uniform uint u_catFilter_<name>[<words>];
bool <name>_passes = ((u_catFilter_<name>[int(<categoryExpr>) / 32] >> (uint(<categoryExpr>) % 32u)) & 1u) == 1u;
```

*Tier 3:*
```glsl
uniform sampler2D u_catFilter_<name>;
bool <name>_passes = texelFetch(u_catFilter_<name>, ivec2(int(<categoryExpr>) / 4, 0), 0)[int(<categoryExpr>) % 4] > 0.5;
```

**GPU upload (each frame, when dirty):**
- Tier 1: pack `checkedSet` into a JS `Uint32Array(1)`, upload as `uint` uniform.
- Tier 2: pack into `Uint32Array(ceil(N/32))`, upload as uniform array.
- Tier 3: write `Float32Array(ceil(N/4) * 4)` with `1.0` at each checked index, upload to a plain regl texture (`format: 'rgba'`, `type: 'float'`). Texture is owned directly by the axis (not a `TextureColumn` — this is filter state, not data).

**Public API on `CategoricalFilterAxis`:**
- `.categories: string[]` — label list (from column metadata)
- `.checkedSet: Set<number>` — mutable; widget toggles entries directly
- `.tier: 1 | 2 | 3`
- `.setChecked(id, bool)` / `.toggleAll(bool)` — helpers that mark dirty and schedule render

---

## Part 3: Filterbar Widget

The `Filterbar` widget inspects the axis type and branches:

- `axis instanceof RangeFilterAxis` → existing histogram + range brush (no change)
- `axis instanceof CategoricalFilterAxis` → checkbox list UI

### Checkbox UI

- One row per entry in `axis.categories`.
- Each row: checkbox + label text.
- Checkbox checked state mirrors `axis.checkedSet.has(i)`.
- On toggle: call `axis.setChecked(i, checked)` → schedules render.
- "All" / "None" convenience buttons at top.
- If category count is large (e.g. > 50), render a scrollable container with a text filter input to search labels.

---

## Implementation Order

1. `ColumnData.withMetadata` + deep merge utility + metadata propagation in derived columns.
2. `CategoricalFilterAxis` class (all three tiers, GLSL generation, GPU upload).
3. `FilterAxisRegistry` dispatch on `column.metadata?.type`.
4. `Filterbar` widget categorical branch.

---

## Out of Scope

- Dynamic tier upgrade if categories are added after axis creation.
- Ordered / ordinal categorical axes (treat as plain numeric for now).
- Automatic inference of categorical metadata from data (caller always annotates explicitly).
