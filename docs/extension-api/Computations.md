# Computations

This page covers how to write custom computations. For using built-in computations see [Built-in Computations](../user-api/BuiltInComputations.md).

---

## `ColumnData` — The Unified Column Type

All columnar data in the computation pipeline is represented as a `ColumnData` instance. There are three concrete subtypes:

### `ArrayColumn`

Wraps a `Float32Array`. Lazily uploads to a GPU texture on first use.

```javascript
import { ArrayColumn } from 'gladly-plot'

const col = new ArrayColumn(myFloat32Array, { domain: [0, 1], quantityKind: 'velocity_ms' })
col.array           // the raw Float32Array (CPU-accessible)
col.length          // number of elements
col.shape           // [col.length] for 1D; pass { shape: [rows, cols] } to constructor for nD
col.ndim            // col.shape.length
col.domain          // [min, max] or null
col.quantityKind    // string or null
col.toTexture(regl) // returns a regl texture (RGBA, 4 values per texel, 2D layout)
col.resolve(path, regl) // returns { glslExpr, textures, shape }
```

Use `instanceof ArrayColumn` checks inside `TextureComputation.compute()` when your computation requires CPU access (e.g. for statistics, sorting, or FFT).

### `TextureColumn`

Wraps a mutable `{ texture }` reference. The reference is shared — when the texture is replaced on refresh, all uniforms picking it up see the new value automatically.

```javascript
col.toTexture(regl)    // returns the current regl texture
col.refresh(plot)      // re-runs refreshFn if present; returns true if texture changed
```

### `GlslColumn`

Wraps named `ColumnData` inputs plus a GLSL template function. Composes GLSL expressions without any GPU render pass. Call `toTexture(regl)` to materialise into a real texture via a GPU point-scatter pass.

```javascript
col.resolve(path, regl) // returns { glslExpr, textures } — all inputs' textures merged
col.toTexture(regl)     // GPU render pass: evaluates the expression per data point
```

### `OffsetColumn`

Wraps another `ColumnData` and shifts the GLSL sampling index by a GLSL expression. Produced by calling `col.withOffset(offsetExpr)` on any `ColumnData`. The offset is evaluated per-vertex, so it can reference vertex-shader variables like `a_endPoint`.

```javascript
import { OffsetColumn } from 'gladly-plot'

// Produced via the helper method (preferred):
const start = colX.withOffset('0.0')   // samples colX at a_pickId + 0
const end   = colX.withOffset('1.0')   // samples colX at a_pickId + 1
const interp = colX.withOffset('a_endPoint')  // per-vertex offset from a template attribute

// Or constructed directly:
const col = new OffsetColumn(baseCol, '1.0')
```

`OffsetColumn` delegates `length`, `domain`, `quantityKind`, `toTexture`, and `refresh` to its base column. Only `resolve()` is overridden to rewrite the GLSL sampling expression.

Typical use case: instanced rendering where two consecutive data points define a line segment. Instead of building interleaved CPU arrays, use `colX.withOffset('0.0')` for the segment start and `colX.withOffset('1.0')` for the segment end, feeding both from the same underlying `ColumnData`.

### Common Interface

All four subtypes share:

| Property / Method | Description |
|-------------------|-------------|
| `col.length` | Total number of data elements (`totalLength`), or `null` if unknown |
| `col.shape` | Array of dimension sizes, e.g. `[1000]` for 1D or `[100, 200]` for 2D. Defaults to `[col.length]`. |
| `col.ndim` | Number of dimensions: `col.shape.length` |
| `col.totalLength` | Product of all shape dimensions |
| `col.domain` | `[min, max]` or `null` |
| `col.quantityKind` | string or `null` |
| `col.withOffset(offsetExpr)` | Returns an `OffsetColumn` that shifts the GLSL sampling index by the given GLSL expression |
| `col.resolve(path, regl)` | Returns `{ glslExpr: string \| null, textures: { uniformName: () => tex }, shape }`. `glslExpr` is `null` for nD columns (shader wrapper generated instead). |
| `col.toTexture(regl)` | Returns a raw regl texture (4 values packed per texel in RGBA) |
| `col.refresh(plot)` | Refreshes if axis-reactive; returns `true` if updated |

The `shape` property is what controls whether a column is treated as **1D** (sampled automatically at `a_pickId` in the vertex shader) or **nD** (accessed via a typed wrapper function, see [nD Column Shader Injection](#nd-column-shader-injection)).

---

## Using a Computed Attribute

Inside `createLayer`, supply a **computation expression** as an attribute value instead of a `Float32Array`:

```javascript
createLayer(parameters, data) {
  return [{
    attributes: {
      x_center: parameters.xData,  // string column name — resolved at render time
      count: { histogram: { input: parameters.yData, bins: 50 } },  // computed attribute
    },
    // ...
  }]
}
```

A computation expression is a **single-key object** `{ computationName: params }` where:

- `computationName` is a registered texture or GLSL computation.
- `params` is the parameter value, resolved recursively before being passed to the computation. Params can be:
  - A column name **string** — resolved to `ColumnData` via the plot's current data.
  - A `Float32Array` — passed through as-is (not converted to `ColumnData`).
  - A number or boolean — passed through as a scalar.
  - Another `{ computationName: params }` expression — computed first; its output `ColumnData` is passed as the input to the outer computation.
  - A plain object — each value is resolved recursively; used for named parameter objects.

---

## Axis-Reactive Recomputation

Texture computations receive a `getAxisDomain` callback. Calling it for an axis ID:

1. Returns the current domain `[min|null, max|null]` for that axis (either bound can be `null` for open intervals).
2. Registers the axis as a **dependency** — the framework recomputes the texture automatically whenever that axis's domain changes (e.g. when the user adjusts a filterbar).

This makes it straightforward to build filter-aware computations:

```javascript
import { TextureComputation, ArrayColumn, uploadToTexture, registerTextureComputation } from 'gladly-plot'
import makeHistogram from './hist.js'

class FilteredHistogramComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    // inputs.input and inputs.filterValues are ColumnData instances
    if (!(inputs.input instanceof ArrayColumn)) throw new Error('requires ArrayColumn')
    if (!(inputs.filterValues instanceof ArrayColumn)) throw new Error('requires ArrayColumn')

    const inputArr = inputs.input.array
    const filterArr = inputs.filterValues.array
    const domain = getAxisDomain(inputs.filterAxisId)  // registers the axis as a dependency
    const filterMin = domain?.[0] ?? null
    const filterMax = domain?.[1] ?? null

    const filtered = []
    for (let i = 0; i < inputArr.length; i++) {
      const fv = filterArr[i]
      if (filterMin !== null && fv < filterMin) continue
      if (filterMax !== null && fv > filterMax) continue
      filtered.push(inputArr[i])
    }
    const filteredTex = uploadToTexture(regl, new Float32Array(filtered))
    return makeHistogram(regl, filteredTex, { bins: inputs.bins })
  }
  schema(data) { /* ... */ }
}

registerTextureComputation('filteredHistogram', new FilteredHistogramComputation())
```

---

## Registering a Texture Computation

```javascript
registerTextureComputation(name, computation)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Key used in computation expressions: `{ [name]: params }` |
| `computation` | `TextureComputation` | Instance of a class extending `TextureComputation` |

Subclass `TextureComputation` and implement two methods:

### `compute(regl, inputs, getAxisDomain)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `regl` | regl context | Use to allocate textures (`regl.texture()`), framebuffers, and draw calls. |
| `inputs` | object | Resolved parameter object. String params that matched data columns are `ColumnData` instances; plain numbers, booleans, and `Float32Array` values pass through unchanged. |
| `getAxisDomain` | `(axisId: string) => [min\|null, max\|null] \| null` | Returns the current domain of an axis and registers it as a dependency. Returns `null` if the axis has no domain yet. |

**Accessing column data inside `compute()`:**
- Call `inputs.col.toTexture(regl)` to get a GPU texture (works for any `ColumnData` subtype).
- Check `inputs.col instanceof ArrayColumn` to test for CPU-accessible data; then use `inputs.col.array` for the raw `Float32Array`.
- Use `instanceof ArrayColumn` guards and throw for computations that strictly need CPU data (e.g. FFT, adaptive convolution).

**Return value:** A regl texture created with `uploadToTexture` (or equivalent). Values are packed 4 per texel in RGBA format; the framework samples them via `sampleColumn(tex, a_pickId)`. Set `tex._dataLength = n` so the framework knows the logical element count (which differs from `tex.width * tex.height * 4`).

### `schema(data)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Data \| null` | The plot's data object, or `null` when called without a data context. |

**Return value:** A JSON Schema (Draft 2020-12) object describing the `params` structure accepted by `compute`. Use `EXPRESSION_REF` for parameters that accept a column reference or a sub-expression.

**Example — custom weighted average texture:**

```javascript
import { TextureComputation, ArrayColumn, uploadToTexture, EXPRESSION_REF, registerTextureComputation } from 'gladly-plot'

class WeightedAverageComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    if (!(inputs.values instanceof ArrayColumn)) throw new Error('values must be ArrayColumn')
    if (!(inputs.weights instanceof ArrayColumn)) throw new Error('weights must be ArrayColumn')
    const { values, weights, bins } = inputs  // values and weights are ArrayColumn
    const vArr = values.array
    const wArr = weights.array
    const outData = new Float32Array(bins)  // one value per bin

    for (let b = 0; b < bins; b++) {
      let sumW = 0, sumWV = 0
      for (let i = 0; i < vArr.length; i++) {
        const bIndex = Math.floor(vArr[i] * bins)
        if (Math.min(bIndex, bins - 1) !== b) continue
        sumW  += wArr[i]
        sumWV += wArr[i] * vArr[i]
      }
      outData[b] = sumW > 0 ? sumWV / sumW : 0
    }

    return uploadToTexture(regl, outData)  // packs 4 values per texel automatically
  }

  schema(data) {
    return {
      type: 'object',
      properties: {
        values:  EXPRESSION_REF,
        weights: EXPRESSION_REF,
        bins:    { type: 'number' }
      },
      required: ['values', 'weights', 'bins']
    }
  }
}

registerTextureComputation('weightedAverage', new WeightedAverageComputation())
```

Usage in `createLayer`:

```javascript
attributes: {
  count: { weightedAverage: { values: 'normalized', weights: 'importance', bins: 50 } }
}
```

---

## Registering a GLSL Computation

```javascript
registerGlslComputation(name, computation)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Key used in computation expressions: `{ [name]: params }` |
| `computation` | `GlslComputation` | Instance of a class extending `GlslComputation` |

Subclass `GlslComputation` and implement two methods:

### `glsl(resolvedGlslParams)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `resolvedGlslParams` | object | Each value is a **GLSL expression string**. Each column-reference param is recursively resolved: `ArrayColumn` → texture-sample expression, `GlslColumn` → composed expression, `TextureColumn` → texture-sample expression. |

**Return value:** A GLSL expression string that evaluates to a `float`.

### `schema(data)`

Same signature as for `TextureComputation.schema`. Return a JSON Schema describing the params object.

**Example — normalised difference:**

```javascript
import { GlslComputation, EXPRESSION_REF, registerGlslComputation } from 'gladly-plot'

class NormalizedDiffComputation extends GlslComputation {
  glsl({ a, b }) {
    return `((${a}) - (${b})) / ((${a}) + (${b}) + 1e-6)`
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        a: EXPRESSION_REF,
        b: EXPRESSION_REF
      },
      required: ['a', 'b']
    }
  }
}

registerGlslComputation('normalizedDiff', new NormalizedDiffComputation())
```

Usage in `createLayer`:

```javascript
attributes: {
  ndvi: {
    normalizedDiff: {
      a: 'nir',   // column name — resolved to ColumnData, then to GLSL expr
      b: 'red',
    }
  }
}
```

---

## `EXPRESSION_REF`

```javascript
import { EXPRESSION_REF } from 'gladly-plot'
```

A JSON Schema `$ref` object (`{ '$ref': '#/$defs/expression' }`) for use inside `schema()` methods. Use it for any parameter that can accept a column name, a `Float32Array`, or a nested computation expression:

```javascript
schema(data) {
  return {
    type: 'object',
    properties: {
      input: EXPRESSION_REF,   // accepts column name, Float32Array, or { computationName: params }
      bins:  { type: 'number' }
    },
    required: ['input']
  }
}
```

The `$ref` resolves to the `expression` entry in `$defs` produced by `computationSchema()`, which is an `anyOf` covering all registered computations and column names.

---

## `uploadToTexture(regl, array)`

```javascript
import { uploadToTexture } from 'gladly-plot'

const tex = uploadToTexture(regl, myFloat32Array)
// tex._dataLength is set to array.length
// tex uses RGBA format: 4 values packed per texel
// 2D layout: w = min(ceil(n/4), maxTextureSize), h = ceil(ceil(n/4) / w)
```

Uploads a `Float32Array` as a GPU texture with **four values packed per texel** (RGBA format). Element `i` is stored in texel `i/4`, channel `i%4` (r=0, g=1, b=2, a=3). The 2D layout automatically handles arrays longer than `maxTextureSize`. Use this inside `TextureComputation.compute()` when you have constructed a CPU-side result array that needs to be returned as a texture.

The returned texture is compatible with `sampleColumn` and `sampleColumnND` GLSL helpers.

---

## `resolveExprToColumn(expr, data, regl, plot)`

```javascript
import { resolveExprToColumn } from 'gladly-plot'

const col = resolveExprToColumn(expr, data, regl, plot)
// col is always a ColumnData instance
```

Resolves any expression form to a `ColumnData`:

| `expr` | Result |
|--------|--------|
| `ColumnData` | returned unchanged |
| `string` | looks up `data.getData(expr)` |
| `{ computationName: params }` | runs the named computation; returns `TextureColumn` or `GlslColumn` |

---

## `SAMPLE_COLUMN_GLSL`

```javascript
import { SAMPLE_COLUMN_GLSL } from 'gladly-plot'
```

A GLSL helper string defining `sampleColumn(sampler2D tex, float idx)`. It is automatically injected into vertex shaders that use 1D column data. You only need it when writing your own custom shaders or compute passes that need to sample column textures directly.

Values are packed **4 per texel** in RGBA channels. Element `i` → texel `i/4`, channel `i%4`:

```glsl
float sampleColumn(sampler2D tex, float idx) {
  ivec2 sz = textureSize(tex, 0);
  int i = int(idx);
  int texelI = i / 4;
  int chan = i % 4;
  ivec2 coord = ivec2(texelI % sz.x, texelI / sz.x);
  vec4 texel = texelFetch(tex, coord, 0);
  if (chan == 0) return texel.r;
  if (chan == 1) return texel.g;
  if (chan == 2) return texel.b;
  return texel.a;
}
```

## `SAMPLE_COLUMN_ND_GLSL`

```javascript
import { SAMPLE_COLUMN_ND_GLSL } from 'gladly-plot'
```

A GLSL helper string defining `sampleColumnND(sampler2D tex, ivec4 shape, ivec4 idx)`. It is automatically injected when any nD column attribute is present. Used for multi-dimensional column access (see [nD Column Shader Injection](#nd-column-shader-injection)).

`shape.xyzw` holds the logical dimension sizes (unused dims = 1). The index is converted to linear (row-major, first dim varies fastest) before unpacking from the 4-per-texel RGBA layout:

```glsl
float sampleColumnND(sampler2D tex, ivec4 shape, ivec4 idx) {
  int i = idx.x + shape.x * (idx.y + shape.y * (idx.z + shape.z * idx.w));
  ivec2 sz = textureSize(tex, 0);
  int texelI = i / 4;
  int chan = i % 4;
  ivec2 coord = ivec2(texelI % sz.x, texelI / sz.x);
  vec4 texel = texelFetch(tex, coord, 0);
  if (chan == 0) return texel.r;
  if (chan == 1) return texel.g;
  if (chan == 2) return texel.b;
  return texel.a;
}
```

---

## nD Column Shader Injection

When a layer attribute is backed by a column with `ndim > 1` (i.e. `col.shape.length > 1`), the framework **does not** auto-inject a `float name = sampleColumn(...)` assignment into `main()`. Instead, it injects:

1. A **shape uniform** `uniform ivec4 u_col_<name>_shape;` (padded to 4D, unused dims = 1).
2. A **typed wrapper function** `float sample_<name>(ivecN idx)` that calls `sampleColumnND` with the correct shape. The vector type matches the column's `ndim`: `ivec2` for 2D, `ivec3` for 3D, `ivec4` for 4D.

The shader can then call `sample_<name>(ivec2(row, col))` directly — no manual index calculation needed.

**Example** — a layer attribute `weights` backed by a 2D column (shape `[rows, cols]`):

```javascript
// In createLayer:
const weightsCol = new ArrayColumn(myFloat32Array, { shape: [rows, cols] })
return [{ attributes: { weights: weightsCol }, ... }]
```

The following is injected automatically into the vertex shader (before `void main()`):

```glsl
uniform ivec4 u_col_weights_shape;       // [rows, cols, 1, 1]
float sample_weights(ivec2 idx) {
  return sampleColumnND(u_col_weights, u_col_weights_shape, ivec4(idx, 0, 0));
}
```

In the vertex shader body, call it as:

```glsl
void main() {
  float w = sample_weights(ivec2(row, col));
  // ...
}
```

Note: the raw `in float weights;` attribute declaration is **stripped** from the shader source automatically. Do not declare it manually.

For nD columns, `SAMPLE_COLUMN_ND_GLSL` and the sampler declarations are also injected into the **fragment shader** (not just the vertex shader), so `sample_<name>` is available in `frag` as well.

---

## `computationSchema(data)`

```javascript
import { computationSchema } from 'gladly-plot'
const schema = computationSchema(data)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Data \| null` | A `Data` instance (for column name enumeration), or `null`. |

**Return value:** A JSON Schema Draft 2020-12 document describing the full space of valid computation expressions. Structure:

```json
{
  "$defs": {
    "params_histogram":          { "type": "object", "properties": { "input": { "$ref": "#/$defs/expression" }, "bins": { "type": "number" } }, "required": ["input"] },
    "params_filteredHistogram":  { "..." },
    "...",
    "expression": {
      "anyOf": [
        { "type": "string", "enum": ["col1", "col2", "..."] },
        { "type": "object", "properties": { "histogram":         { "$ref": "#/$defs/params_histogram"         } }, "required": ["histogram"],         "additionalProperties": false },
        { "..." }
      ]
    }
  },
  "$ref": "#/$defs/expression"
}
```

- Column names are populated from `data.columns()` when `data` is provided.
- Each computation contributes its `schema(data)` return value as `$defs.params_<name>`.
- `EXPRESSION_REF` inside any `schema()` method references this same `$defs.expression` entry, enabling recursive nesting.

---

## `Computation` Abstract Base Class

```javascript
import { Computation } from 'gladly-plot'
```

Abstract base class for all computations. Subclass `TextureComputation` or `GlslComputation` rather than this directly.

**Method to implement:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `schema(data)` | `(data: Data \| null) => JSONSchema` | Return a JSON Schema (Draft 2020-12) describing the `params` object the computation accepts. Use `EXPRESSION_REF` for params that accept a `Float32Array` or sub-expression. |

---

## Worked Example: Histogram Layer

The built-in `bars` layer type demonstrates the full pattern. Relevant excerpt from its `createLayer`:

```javascript
_createLayer(parameters, data) {
  const d = Data.wrap(data)
  const { xData, yData, color = [0.2, 0.5, 0.8, 1.0] } = parameters

  // getData() now returns ColumnData (ArrayColumn or TextureColumn)
  const xCol = d.getData(xData)
  const yCol = d.getData(yData)

  const bins = xCol.length ?? 1
  const xDomain = xCol.domain ?? [0, 1]
  const yDomain = yCol.domain ?? [0, 1]
  const binHalfWidth = (xDomain[1] - xDomain[0]) / (2 * bins)

  const a_corner = new Float32Array([0, 1, 2, 3])

  return [{
    attributes: {
      a_corner,       // Float32Array — uploaded as vertex buffer
      x_center: xData,  // string column name — resolved to ColumnData at draw time
      count: yData,      // string column name — resolved to ColumnData at draw time
    },
    uniforms: { u_binHalfWidth: binHalfWidth, u_color: color },
    vertexCount: 4,
    instanceCount: bins,
    primitive: 'triangle strip',
    domains: { [xQK]: xDomain, [yQK]: yDomain },
  }]
}
```

The `x_center` and `count` attributes are column names. The framework resolves them to `ColumnData` instances at draw time, uploads them to GPU textures, and samples them in the vertex shader:

```glsl
in float a_corner;
in float x_center;   // replaced by: float x_center = sampleColumn(u_col_x_center, a_pickId);
in float count;      // replaced by: float count    = sampleColumn(u_col_count,    a_pickId);

uniform float u_binHalfWidth;

void main() {
  float side = mod(a_corner, 2.0);
  float top  = floor(a_corner / 2.0);
  float bx   = x_center + (side * 2.0 - 1.0) * u_binHalfWidth;
  float by   = top * count;
  gl_Position = plot_pos(vec2(bx, by));
}
```
