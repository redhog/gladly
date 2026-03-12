# ComputePipeline

A headless GPU compute pipeline for running data transforms without any visual output. It creates its own offscreen WebGL context — no DOM container or `<canvas>` element is needed.

`ComputePipeline` uses the same transform system as `Plot` (`config.transforms`), including filter axes. Use it to run computations server-side, in workers, or any time you need GPU-accelerated results as CPU arrays.

---

## Constructor

```javascript
new ComputePipeline()
```

No arguments. The WebGL context is created immediately in the constructor.

---

## Instance properties

### `pipeline.axes`

A proxy that returns a stable [`Axis`](Axis.md) instance for any registered filter axis name:

```javascript
pipeline.axes["depth_m"].getDomain()          // [min, max] or null
pipeline.axes["depth_m"].setDomain([0, 500])  // update filter range
```

Axis instances are stable across `update()` calls. They support `subscribe()` / `unsubscribe()` and can be linked to axes on a `Plot` or another `ComputePipeline` via [`linkAxes()`](Axis.md#linkaxesaxis1-axis2):

```javascript
// Sync the filter on a plot's filterbar to the pipeline's filter axis
linkAxes(plot.axes["depth_m"], pipeline.axes["depth_m"])
```

Only **filter axes** are meaningful on a `ComputePipeline` (there are no spatial or color axes). Axis instances are created on first access; they become non-null after the first `update()` call that registers the axis.

---

## Instance methods

### `update({ data, transforms, axes })`

Runs the given transforms over `data` and returns a [`ComputeOutput`](#computeoutput).

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | object | Input data — any plain object that `normalizeData()` can convert (see [Data Format](../README.md#data-format)). Omit to reuse the data from the previous `update()` call. |
| `transforms` | array | Array of `{ name, transform: { ClassName: params } }` objects, in the same format as `config.transforms` in `Plot`. Default: `[]`. |
| `axes` | object | Filter axis range overrides: `{ [quantityKind]: { min, max } }`. Either bound may be omitted for an open interval. Default: `{}`. |

**Behaviour:**

Transforms are run in declaration order. Each transform can reference columns from `data` (as `"input.colName"`) or from a previously declared transform output (as `"transformName.colName"`).

Filter axis ranges are applied **after** transforms register their axes (so the range is always set on an axis that exists). Transforms whose output depends on a filter axis are then re-run with the configured range in place.

```javascript
const pipeline = new ComputePipeline()

const output = pipeline.update({
  data: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
  transforms: [
    { name: 'hist', transform: { HistogramData: { input: 'input.vp', bins: 64 } } }
  ],
  axes: {
    // If the transform registers a filter axis, set its range here:
    depth_m: { min: 0, max: 3000 }
  }
})

const counts = output.getData('hist.counts').getArray()  // Float32Array
const centers = output.getData('hist.binCenters').getArray()
```

### `destroy()`

Destroys the WebGL context and frees GPU resources. After `destroy()`, calling `update()` will throw.

---

# ComputeOutput

The object returned by [`ComputePipeline.update()`](#updatedata-transforms-axes). Provides access to transform output columns as CPU arrays.

Column names use dot notation: input data columns are under `"input.*"`, and each transform's outputs are under `"transformName.*"` (matching the `name` given in the `transforms` array).

---

## `output.columns()`

Returns `string[]` — all available dotted column names, including both input data columns and transform outputs.

```javascript
output.columns()
// ['input.depth', 'input.vp', 'hist.counts', 'hist.binCenters', ...]
```

---

## `output.getData(col)`

Returns a [`ColumnData`](../extension-api/Computations.md#columndata--the-unified-column-type) subclass instance for column `col`, extended with an additional `getArray()` method. Returns `null` if the column does not exist.

```javascript
const col = output.getData('hist.counts')
const arr = col.getArray()  // Float32Array — GPU readback if needed
```

The returned object is a full `ColumnData` instance — it also supports `col.length`, `col.domain`, `col.quantityKind`, `col.toTexture(regl)`, etc.

---

## `output.getData(col).getArray()`

Returns a `Float32Array` of the column's values on the CPU.

- For columns backed by a `Float32Array` (input data), returns the array directly with no GPU round-trip.
- For columns produced by a texture computation (transform outputs), reads the GPU texture back to CPU via a temporary framebuffer. The texture data is unpacked from the 4-values-per-texel RGBA format used internally.

---

## `output.getArrays()`

Reads all columns to CPU at once and returns a plain object:

```javascript
const arrays = output.getArrays()
// {
//   'input.depth':    Float32Array([...]),
//   'input.vp':       Float32Array([...]),
//   'hist.counts':    Float32Array([...]),
//   'hist.binCenters': Float32Array([...]),
// }
```

Columns that fail to read (e.g. uninitialized texture) are skipped with a `console.warn`; the rest are still returned.
