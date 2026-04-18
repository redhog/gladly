# Data

A class that normalises a flat plain JavaScript dataset into a consistent columnar interface. `getData()` always returns a `ColumnData` instance.

The framework calls `normalizeData()` on the `data` argument to `plot.update()`, which uses `Data.wrap()` internally. The result is always a `DataGroup` tree whose leaves are `Data` instances. Layer types receive this normalised `DataGroup` as their `data` argument and call `Data.wrap(data)` on it (a no-op when already normalised).

---

## Supported plain-object formats

**Simple** — a flat object of `Float32Array` values (no metadata):

```javascript
{
  x: new Float32Array([...]),
  y: new Float32Array([...]),
  v: new Float32Array([...])
}
```

**Per-column rich** — each column is an object with a `data` array and optional metadata:

```javascript
{
  x: { data: new Float32Array([...]), quantity_kind: "distance_m", domain: [0, 10] },
  y: { data: new Float32Array([...]), quantity_kind: "voltage_V" },
  v: { data: new Float32Array([...]), quantity_kind: "temperature_K", domain: { min: 0, max: 100 } }
}
```

**Columnar** — data arrays, quantity kinds, and domains kept in parallel sub-objects:

```javascript
{
  data: {
    x: new Float32Array([...]),
    y: new Float32Array([...]),
    v: new Float32Array([...])
  },
  quantity_kinds: {           // optional — any entry can be omitted
    x: "distance_m",
    y: "voltage_V",
    v: "temperature_K"
  },
  domains: {                  // optional — any entry can be omitted
    x: [0, 10],               // [min, max] array, or
    v: { min: 0, max: 100 }   // {min, max} object — both forms accepted
  }
}
```

In all formats, `quantity_kind` / `quantity_kinds` and `domain` / `domains` are fully optional on any individual column. Missing quantity kinds fall back to the column name; missing domains are auto-calculated from the data array.

---

## `Data.wrap(data)`

```javascript
import { Data } from './src/index.js'
const d = Data.wrap(rawData)
```

The primary entry point. Returns `data` **unchanged** if it already has `columns` and `getData` methods (duck-typing — any conforming class works, not just `Data` itself). Otherwise inspects the plain object and selects the appropriate wrapper:

| Input shape | Result |
|-------------|--------|
| Already has `columns` + `getData` methods | returned unchanged |
| Has a top-level `data` key whose value is a plain object | `Data` — columnar format |
| All top-level values are `Float32Array` | `Data` — simple format |
| All top-level values are `{ data: Float32Array, ... }` | `Data` — per-column rich format |
| Any other case (top-level values are plain objects) | [`DataGroup`](#datagroup) — hierarchical |

When a `DataGroup` is created, each child value is recursively passed through `Data.wrap()`, so any nesting depth is handled automatically.

---

## `data.columns()`

Returns `string[]` — the list of column names.

---

## `data.getData(col)`

Returns a `ColumnData` instance (`ArrayColumn` for plain `Float32Array` data) for column `col`, or `null` if the column does not exist. To get the underlying `Float32Array`, use `col.array` (only on `ArrayColumn` instances); to upload as GPU textures use `col.toTexture(regl)` (any `ColumnData` subtype).

```javascript
const col = d.getData('x')   // → ArrayColumn (or null)
if (col instanceof ArrayColumn) {
  const arr = col.array      // Float32Array (CPU access)
}
const textures = await col.toTexture(regl)  // texture[] — one element per tile (usually [0] for tile 0)
const tex = textures[0]
```

---

## `data.getQuantityKind(col)`

Returns the quantity kind string for column `col`, or `null`/`undefined` if none was specified. Layer type authors typically fall back to the column name when undefined:

```javascript
const qk = d.getQuantityKind(params.vData) ?? params.vData
```

When a quantity kind is present, it is used as the axis identity (the key in `config.axes`) instead of the raw column name. This means two datasets that call the same physical quantity the same thing will automatically share axes.

---

## `data.getDomain(col)`

Returns `[min, max]` for column `col`, or `undefined` if no domain was specified. When returned, the built-in layers pass it as the `domains` entry in the `createLayer` return value, which tells the plot to skip its own min/max scan of the data array for that axis.

---

# DataGroup

A class that wraps a **nested** object — where the top-level values are themselves data collections rather than typed arrays — into a consistent hierarchical interface. Column names are expressed in **dot notation**: `"child.column"` or `"subgroup.child.column"` at any depth. `getData()` always returns a `ColumnData` instance.

`DataGroup` is the top-level container produced by `normalizeData()`. The framework stores the normalised `DataGroup` as `plot.currentData` and passes it as the `data` argument to every layer type's `createLayer` and `getAxisConfig`. It is created automatically by `Data.wrap()` when the input is a nested object; you do not normally construct it directly.

---

## Examples

**Nested datasets → `DataGroup` of flat `Data` objects:**

```javascript
import { Data } from './src/index.js'

const group = Data.wrap({
  survey1: { x: new Float32Array([1, 2, 3]), y: new Float32Array([4, 5, 6]) },
  survey2: { x: new Float32Array([7, 8, 9]), y: new Float32Array([0, 1, 2]) }
})
// → DataGroup
//   group.columns()            → ['survey1.x', 'survey1.y', 'survey2.x', 'survey2.y']
//   group.getData('survey1.x') → Float32Array([1, 2, 3])
//   group.listData()           → { survey1: Data, survey2: Data }
```

**Columnar children → each child is detected as columnar `Data`:**

```javascript
const group = Data.wrap({
  run1: {
    data: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
    quantity_kinds: { depth: 'depth_m', vp: 'velocity_ms' }
  },
  run2: {
    data: { depth: new Float32Array([...]), vp: new Float32Array([...]) }
  }
})
// group.getQuantityKind('run1.depth') → 'depth_m'
// group.getData('run2.vp')           → Float32Array([...])
```

**Multi-level nesting → `DataGroup` of `DataGroup` of `Data`:**

```javascript
const group = Data.wrap({
  region_a: {
    shallow: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
    deep:    { depth: new Float32Array([...]), vp: new Float32Array([...]) }
  },
  region_b: { depth: new Float32Array([...]), vp: new Float32Array([...]) }
})
// group.columns() →
//   ['region_a.shallow.depth', 'region_a.shallow.vp',
//    'region_a.deep.depth',    'region_a.deep.vp',
//    'region_b.depth',         'region_b.vp']
// group.subgroups()  → { region_a: DataGroup }
// group.listData()   → { region_b: Data }
```

---

## `dataGroup.listData()`

Returns `{ [key]: Data }` — a plain object of the immediate children that are `Data` instances (not sub-groups).

---

## `dataGroup.subgroups()`

Returns `{ [key]: DataGroup }` — a plain object of the immediate children that are `DataGroup` instances.

---

## `dataGroup.columns()`

Returns all dotted column names recursively across all children. The order follows insertion order of the top-level keys, recursing depth-first.

---

## `dataGroup.getData(col)`

Returns the `ColumnData` instance for the dotted column name `col`, or `undefined` if the path does not exist. Delegates to the appropriate child `Data` or `DataGroup` node.

---

## `dataGroup.getQuantityKind(col)`

Returns the quantity kind string for the dotted column name, or `undefined` if none was specified.

---

## `dataGroup.getDomain(col)`

Returns `[min, max]` for the dotted column name, or `undefined` if none was specified.
