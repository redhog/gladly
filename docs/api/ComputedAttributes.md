# Computed Attributes

Computed attributes let layer types put a **computation expression** in the `attributes` map returned from `createLayer` instead of a plain `Float32Array`. The framework resolves the expression into a GPU-sampled value at render time, optionally recomputing it whenever a dependent axis domain changes.

---

## Why Use Computed Attributes

Normally every value in `attributes` is a `Float32Array` uploaded as a vertex buffer. Computed attributes extend this with two additional forms:

- **Texture computations** — a CPU or GPU function produces a 1-D texture; each vertex samples it by its `a_pickId` index. Typical use: histograms, filtered counts, signal transforms.
- **GLSL computations** — a function returns a GLSL expression string; the framework injects it directly into the vertex shader. Typical use: arithmetic combining other attribute values.

Either form is transparent to the shader author: the attribute appears in the shader as an ordinary `float` attribute (backed by the sampled texture or the GLSL expression).

You may also use a **plain column name string** as an attribute value — the framework resolves it through the plot's current data automatically.

---

## `ColumnData` — The Unified Column Type

All columnar data in the computation pipeline is represented as a `ColumnData` instance. There are three concrete subtypes:

### `ArrayColumn`

Wraps a `Float32Array`. Lazily uploads to a GPU texture on first use.

```javascript
import { ArrayColumn } from 'gladly-plot'

const col = new ArrayColumn(myFloat32Array, { domain: [0, 1], quantityKind: 'velocity_ms' })
col.array          // the raw Float32Array (CPU-accessible)
col.length         // number of elements
col.domain         // [min, max] or null
col.quantityKind   // string or null
col.toTexture(regl) // returns a regl texture (R channel, 1 value/texel, 2D layout)
col.resolve(path, regl) // returns { glslExpr, textures }
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

All three subtypes share:

| Property / Method | Description |
|-------------------|-------------|
| `col.length` | Number of data elements, or `null` if unknown |
| `col.domain` | `[min, max]` or `null` |
| `col.quantityKind` | string or `null` |
| `col.resolve(path, regl)` | Returns `{ glslExpr: string, textures: { uniformName: () => tex } }` |
| `col.toTexture(regl)` | Returns a raw regl texture |
| `col.refresh(plot)` | Refreshes if axis-reactive; returns `true` if updated |

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

**Return value:** A regl texture. The framework samples it per-vertex using `a_pickId` as the texel index, reading the `R` channel as the attribute value. Set `tex._dataLength = n` when the logical length differs from `tex.width * tex.height`.

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
    const outData = new Float32Array(bins * 4)  // RGBA, R channel used

    for (let b = 0; b < bins; b++) {
      let sumW = 0, sumWV = 0
      for (let i = 0; i < vArr.length; i++) {
        const bIndex = Math.floor(vArr[i] * bins)
        if (Math.min(bIndex, bins - 1) !== b) continue
        sumW  += wArr[i]
        sumWV += wArr[i] * vArr[i]
      }
      outData[b * 4] = sumW > 0 ? sumWV / sumW : 0  // R channel
    }

    return regl.texture({ data: outData, width: bins, height: 1, type: 'float', format: 'rgba' })
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
// tex uses R channel, 2D layout (w = min(n, maxTextureSize), h = ceil(n/w))
```

Uploads a `Float32Array` as a GPU texture with one value per texel in the R channel. The 2D layout automatically handles arrays longer than `maxTextureSize`. Use this inside `TextureComputation.compute()` when you have constructed a CPU-side result array that needs to be returned as a texture.

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

A GLSL helper string defining `sampleColumn(sampler2D tex, float idx)`. It is automatically injected into vertex shaders that use column data. You only need it when writing your own custom shaders or compute passes that need to sample column textures directly:

```glsl
float sampleColumn(sampler2D tex, float idx) {
  ivec2 sz = textureSize(tex, 0);
  int i = int(idx);
  return texelFetch(tex, ivec2(i % sz.x, i / sz.x), 0).r;
}
```

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

## Built-in Computations

All built-in computations are registered automatically on import of `gladly-plot`.

### Texture format

All built-in computations that produce output textures use **R-channel, one-value-per-texel, 2D layout** (matching `uploadToTexture`). GLSL shaders sample them with `sampleColumn()`.

### `histogram`

Bins a data column or expression into a histogram texture.

```javascript
{ histogram: { input: 'columnName', bins?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | expression | Column to histogram. If `ArrayColumn`, auto-selects bin count via Scott's rule and normalises to `[0, 1]` internally. If a GPU texture column, assumed already normalised to `[0, 1]`. |
| `bins` | `number` (optional) | Number of histogram bins. Auto-selected if omitted and input is `ArrayColumn`. |

Output texture: width = `bins`, height = 1, R channel = count per bin.

---

### `filteredHistogram`

Like `histogram` but filters the input by a filter axis range before counting. Automatically recomputes when the filter axis domain changes. **Requires `ArrayColumn` inputs** (CPU data).

```javascript
{
  filteredHistogram: {
    input:        'normalizedColumn',  // ArrayColumn required
    filterValues: 'rawFilterColumn',   // ArrayColumn required
    filterAxisId: 'velocity_ms',       // axis quantity kind to watch
    bins?:        number,
  }
}
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `ArrayColumn` expression | Values normalised to `[0, 1]` (for histogram bins). |
| `filterValues` | `ArrayColumn` expression | Raw values for the filter column (same length as `input`). |
| `filterAxisId` | string | Axis quantity kind whose domain drives the filter. The computation re-runs whenever this axis's domain changes. |
| `bins` | number (optional) | Bin count. |

---

### `kde`

Smooths a histogram texture with a Gaussian kernel to produce a kernel density estimate.

```javascript
{ kde: { input: 'histogramExpr', bins?: number, bandwidth?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | expression | A histogram texture (width = bins, height = 1, R = counts). Typically the output of `histogram` or `filteredHistogram`. |
| `bins` | number (optional) | Output bin count. Defaults to `input.width`. |
| `bandwidth` | number (optional) | Gaussian sigma in bins. Default: `5`. |

---

### `filter1D`

Applies an arbitrary 1-D convolution kernel (GPU-side, max radius 16).

```javascript
{ filter1D: { input: 'signalExpr', kernel: 'kernelExpr' } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | expression | Signal to filter; resolved to a GPU texture via `toTexture()`. |
| `kernel` | expression | Convolution kernel weights. Resolved to `ArrayColumn.array` if available, otherwise used as-is. Max length 33 (radius 16). |

---

### `lowPass`

Gaussian low-pass filter.

```javascript
{ lowPass: { input: 'signalExpr', sigma?: number, kernelSize?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | expression | Signal to filter; resolved to a GPU texture. |
| `sigma` | number (optional) | Gaussian standard deviation in samples. Default: `3`. |
| `kernelSize` | number (optional) | Kernel width (must be odd). Default: `ceil(sigma * 6)` rounded to next odd. |

---

### `highPass`

High-pass filter: `input − lowPass(input)`.

```javascript
{ highPass: { input: 'signalExpr', sigma?: number, kernelSize?: number } }
```

Same parameters as `lowPass`. Input resolved to a GPU texture.

---

### `bandPass`

Band-pass filter: `lowPass(sigmaHigh) − lowPass(sigmaLow)`.

```javascript
{ bandPass: { input: 'signalExpr', sigmaLow: number, sigmaHigh: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | expression | Signal to filter; resolved to a GPU texture. |
| `sigmaLow` | number | Sigma of the narrow low-pass (high-frequency cutoff). |
| `sigmaHigh` | number | Sigma of the wide low-pass (low-frequency cutoff). |

---

### `fft1d`

GPU FFT of a real-valued signal. **Requires `ArrayColumn` input** (CPU data). Output is a **complex texture**: R channel = real part, G channel = imaginary part. Size is padded to the next power of two.

```javascript
{ fft1d: { input: 'realColumnName', inverse?: boolean } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `ArrayColumn` expression | Real-valued signal. Imaginary part assumed zero. |
| `inverse` | boolean (optional) | `true` for inverse FFT. Default: `false`. |

---

### `fftConvolution`

Convolves two signals using FFT-based multiplication. **Requires `ArrayColumn` inputs.**

```javascript
{ fftConvolution: { signal: 'columnName', kernel: 'columnName' } }
```

| Param | Type | Description |
|-------|------|-------------|
| `signal` | `ArrayColumn` expression | Input signal. |
| `kernel` | `ArrayColumn` expression | Convolution kernel. |

---

### `convolution`

Adaptive 1-D convolution. **Requires `ArrayColumn` inputs.** Selects the most efficient algorithm based on kernel size:

- **Kernel ≤ 1024 samples** — single GPU pass.
- **Kernel 1025–8192** — chunked GPU passes with additive blending.
- **Kernel > 8192** — FFT-based convolution.

```javascript
{ convolution: { signal: 'columnName', kernel: 'columnName' } }
```

| Param | Type | Description |
|-------|------|-------------|
| `signal` | `ArrayColumn` expression | Input signal. |
| `kernel` | `ArrayColumn` expression | Convolution kernel. |

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
