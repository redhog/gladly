# Computed Attributes

Computed attributes let layer types put a **computation expression** in the `attributes` map returned from `createLayer` instead of a plain `Float32Array`. The framework resolves the expression into a GPU-sampled value at render time, optionally recomputing it whenever a dependent axis domain changes.

---

## Why Use Computed Attributes

Normally every value in `attributes` is a `Float32Array` uploaded as a vertex buffer. Computed attributes extend this with two additional forms:

- **Texture computations** — a CPU or GPU function produces a 1-D texture; each vertex samples it by its `a_pickId` index. Typical use: histograms, filtered counts, signal transforms.
- **GLSL computations** — a function returns a GLSL expression string; the framework injects it directly into the vertex shader. Typical use: arithmetic combining other attribute values.

Either form is transparent to the shader author: the attribute appears in the shader as an ordinary `float` attribute (backed by the sampled texture or the GLSL expression).

---

## Using a Computed Attribute

Inside `createLayer`, supply a **computation expression** as an attribute value instead of a `Float32Array`:

```javascript
createLayer(parameters, data) {
  const normalized = /* Float32Array of values in [0, 1] */
  const bins = 50

  return [{
    attributes: {
      x_center: /* Float32Array */,              // plain array — unchanged
      count: { histogram: { input: normalized, bins } },  // computed attribute
    },
    // ...
  }]
}
```

A computation expression is a **single-key object** `{ computationName: params }` where:

- `computationName` is a registered texture or GLSL computation.
- `params` is the parameter value, which is resolved recursively before being passed to the computation. Params can be:
  - A `Float32Array` — used as-is.
  - A number — passed as a scalar (uploaded as a GPU uniform inside texture computations).
  - A regl texture — used as-is.
  - Another `{ computationName: params }` expression — computed first, and its output (a texture) is passed as input to the outer computation.
  - A plain object — each value is resolved recursively; used to pass named parameters to the computation.

---

## Axis-Reactive Recomputation

Texture computations receive a `getAxisDomain` callback. Calling it for an axis ID:

1. Returns the current domain `[min|null, max|null]` for that axis (either bound can be `null` for open intervals).
2. Registers the axis as a **dependency** — the framework will recompute the texture automatically whenever that axis's domain changes (e.g. when the user adjusts a filterbar).

This makes it straightforward to build filter-aware computations:

```javascript
import { TextureComputation, registerTextureComputation } from 'gladly-plot'
import makeHistogram from './hist.js'

class FilteredHistogramComputation extends TextureComputation {
  compute(regl, params, getAxisDomain) {
    const { input, filterValues, filterAxisId, bins } = params
    const domain = getAxisDomain(filterAxisId)  // registers the axis as a dependency
    const filterMin = domain?.[0] ?? null
    const filterMax = domain?.[1] ?? null

    const filtered = []
    for (let i = 0; i < input.length; i++) {
      const fv = filterValues[i]
      if (filterMin !== null && fv < filterMin) continue
      if (filterMax !== null && fv > filterMax) continue
      filtered.push(input[i])
    }
    return makeHistogram(regl, new Float32Array(filtered), { bins })
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

### `compute(regl, params, getAxisDomain)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `regl` | regl context | Use to allocate textures (`regl.texture()`), framebuffers, and draw calls. |
| `params` | any | The resolved parameter value from the expression. For a plain-object expression this is a plain object with all nested values already resolved to raw JS values (arrays, textures, numbers). |
| `getAxisDomain` | `(axisId: string) => [min\|null, max\|null] \| null` | Returns the current domain of an axis and registers it as a dependency. Returns `null` if the axis has no domain yet. |

**Return value:** A regl texture. The framework samples it per-vertex using `a_pickId` as the texel index, reading the `R` channel as the attribute value.

### `schema(data)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Data \| null` | The plot's data object, or `null` when called without a data context. |

**Return value:** A JSON Schema (Draft 2020-12) object describing the `params` structure accepted by `compute`. Use `EXPRESSION_REF` for parameters that can be a `Float32Array` or a sub-expression.

**Example — custom weighted average texture:**

```javascript
import { TextureComputation, EXPRESSION_REF, registerTextureComputation } from 'gladly-plot'

class WeightedAverageComputation extends TextureComputation {
  compute(regl, params) {
    const { values, weights, bins } = params  // both Float32Arrays
    const outData = new Float32Array(bins * 4)  // RGBA, R channel used

    for (let b = 0; b < bins; b++) {
      let sumW = 0, sumWV = 0
      for (let i = 0; i < values.length; i++) {
        const bIndex = Math.floor(values[i] * bins)
        if (Math.min(bIndex, bins - 1) !== b) continue
        sumW  += weights[i]
        sumWV += weights[i] * values[i]
      }
      outData[b * 4] = sumW > 0 ? sumWV / sumW : 0  // R channel
    }

    return regl.texture({
      data: outData,
      width: bins,
      height: 1,
      type: 'float',
      format: 'rgba'
    })
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
  count: { weightedAverage: { values: normalized, weights: importanceArr, bins } }
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
| `resolvedGlslParams` | object | Each value is a **GLSL expression string** (not a JS value). Each param is recursively resolved: `Float32Array` → attribute name, number → uniform name, texture → texture-sample expression, nested computation → its GLSL expression. |

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
      a: data.nir,   // Float32Array — resolved to an attribute GLSL name
      b: data.red,   // Float32Array — resolved to another attribute GLSL name
    }
  }
}
```

> **Restriction:** GLSL computations cannot be nested inside texture computation parameters. A texture computation's params are resolved to raw JS values (arrays, textures, numbers); GLSL expressions only exist inside the GPU shader and cannot be passed as CPU values.

---

## `EXPRESSION_REF`

```javascript
import { EXPRESSION_REF } from 'gladly-plot'
```

A JSON Schema `$ref` object (`{ '$ref': '#/$defs/expression' }`) for use inside `schema()` methods. Use it for any parameter that can accept a `Float32Array` or a nested computation expression:

```javascript
schema(data) {
  return {
    type: 'object',
    properties: {
      input: EXPRESSION_REF,   // accepts Float32Array or { computationName: params }
      bins:  { type: 'number' }
    },
    required: ['input']
  }
}
```

The `$ref` resolves to the `expression` entry in `$defs` produced by `computationSchema()`, which is an `anyOf` covering all registered computations and column names.

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
    "params_filteredHistogram":  { ... },
    "...",
    "expression": {
      "anyOf": [
        { "type": "string", "enum": ["col1", "col2", "..."] },
        { "type": "object", "properties": { "histogram":         { "$ref": "#/$defs/params_histogram"         } }, "required": ["histogram"],         "additionalProperties": false },
        { "type": "object", "properties": { "filteredHistogram": { "$ref": "#/$defs/params_filteredHistogram" } }, "required": ["filteredHistogram"], "additionalProperties": false },
        "..."
      ]
    }
  },
  "$ref": "#/$defs/expression"
}
```

- Column names are populated from `data.columns()` when `data` is provided; the `enum` is empty otherwise.
- Each computation contributes its `schema(data)` return value as `$defs.params_<name>`.
- The `$defs.expression` entry is an `anyOf` covering column references and every registered computation.
- `EXPRESSION_REF` inside any `schema()` method references this same `$defs.expression` entry, enabling recursive nesting.

Use this to drive form rendering or validation for user-configurable computation expressions:

```javascript
import { computationSchema } from 'gladly-plot'

const schema = computationSchema(myData)
// Pass schema to a JSON Schema form library or validator
```

---

## `isTexture(value)`

```javascript
import { isTexture } from 'gladly-plot'
isTexture(value)  // => boolean
```

Duck-type check for regl textures. Returns `true` if `value` is a non-null object with a numeric `width` property and a `subimage` method.

Useful inside `compute()` when a parameter may be either a raw `Float32Array` or an already-computed texture from a nested expression:

```javascript
class MyComputation extends TextureComputation {
  compute(regl, params) {
    const input = isTexture(params.input)
      ? params.input                      // use the texture directly
      : uploadToTexture(regl, params.input) // upload the Float32Array
    // ...
  }
}
```

---

## Built-in Computations

All built-in computations are registered automatically on import of `gladly-plot`.

### `histogram`

Bins a normalized data array into a histogram texture.

```javascript
{ histogram: { input: Float32Array, bins?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` | Values normalized to `[0, 1]`. |
| `bins` | `number` (optional) | Number of histogram bins. Auto-selected via Scott's rule if omitted. |

Output texture: width = `bins`, R channel = count per bin.

---

### `filteredHistogram`

Like `histogram` but filters the input by a filter axis range before counting. Automatically recomputes when the filter axis domain changes.

```javascript
{
  filteredHistogram: {
    input:        Float32Array,  // values normalized to [0, 1]
    filterValues: Float32Array,  // raw filter-column values (same length as input)
    filterAxisId: string,        // quantity kind / axis ID to watch
    bins?:        number,
  }
}
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` | Values normalized to `[0, 1]`. |
| `filterValues` | `Float32Array` | Raw values for the filter column (same length as `input`). |
| `filterAxisId` | string | Axis quantity kind whose domain drives the filter. The computation re-runs whenever this axis's domain changes. |
| `bins` | number (optional) | Bin count; auto-selected if omitted. |

---

### `kde`

Smooths a histogram (or any 1-D texture) with a Gaussian kernel to produce a kernel density estimate.

```javascript
{ kde: { input: Float32Array | Texture, bins?: number, bandwidth?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` or texture | Raw histogram data, or an existing histogram texture. |
| `bins` | number (optional) | Output bin count. Defaults to `input.length` for arrays, or `input.width` for textures. |
| `bandwidth` | number (optional) | Gaussian sigma in bins. Default: `5`. |

---

### `filter1D`

Applies an arbitrary 1-D convolution kernel (GPU-side, max radius 16).

```javascript
{ filter1D: { input: Float32Array | Texture, kernel: Float32Array } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` or texture | Signal to filter. |
| `kernel` | `Float32Array` | Convolution kernel weights. Length must be odd; max length 33 (radius 16). |

---

### `lowPass`

Gaussian low-pass filter.

```javascript
{ lowPass: { input: Float32Array | Texture, sigma?: number, kernelSize?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` or texture | Signal to filter. |
| `sigma` | number (optional) | Gaussian standard deviation in samples. Default: `3`. |
| `kernelSize` | number (optional) | Kernel width (must be odd). Default: `ceil(sigma * 6)` rounded up to the next odd number. |

---

### `highPass`

High-pass filter: `input − lowPass(input)`.

```javascript
{ highPass: { input: Float32Array | Texture, sigma?: number, kernelSize?: number } }
```

Same parameters as `lowPass`.

---

### `bandPass`

Band-pass filter: `lowPass(sigmaHigh) − lowPass(sigmaLow)`.

```javascript
{ bandPass: { input: Float32Array | Texture, sigmaLow: number, sigmaHigh: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` or texture | Signal to filter. |
| `sigmaLow` | number | Sigma of the narrow low-pass (defines the high-frequency cutoff). |
| `sigmaHigh` | number | Sigma of the wide low-pass (defines the low-frequency cutoff). |

---

### `fft1d`

GPU FFT of a real-valued signal. Output is a **complex texture**: R channel = real part, G channel = imaginary part. Size is padded to the next power of two.

```javascript
{ fft1d: { input: Float32Array, inverse?: boolean } }
```

| Param | Type | Description |
|-------|------|-------------|
| `input` | `Float32Array` | Real-valued signal. Imaginary part assumed zero. |
| `inverse` | boolean (optional) | `true` for inverse FFT. Default: `false`. |

To use the magnitude as a vertex attribute, chain it with a GLSL computation:

```javascript
import { GlslComputation, EXPRESSION_REF, registerGlslComputation } from 'gladly-plot'

class MagnitudeComputation extends GlslComputation {
  glsl({ re, im }) {
    return `sqrt((${re})*(${re}) + (${im})*(${im}))`
  }
  schema(data) {
    return {
      type: 'object',
      properties: { re: EXPRESSION_REF, im: EXPRESSION_REF },
      required: ['re', 'im']
    }
  }
}
registerGlslComputation('magnitude', new MagnitudeComputation())

// In createLayer:
attributes: {
  amplitude: {
    magnitude: {
      re: { fft1d: { input: signal } },           // R channel → 'attribute float a_cgen_...'
      im: /* need separate texture for G channel */ // not directly supported — see note below
    }
  }
}
```

> **Note:** The `fft1d` texture expression samples only the R channel. To access the imaginary (G) channel you currently need to write a custom texture computation that reads both channels and returns a derived scalar.

---

### `fftConvolution`

Convolves two signals using FFT-based multiplication. Efficient for large kernels.

```javascript
{ fftConvolution: { signal: Float32Array, kernel: Float32Array } }
```

| Param | Type | Description |
|-------|------|-------------|
| `signal` | `Float32Array` | Input signal. |
| `kernel` | `Float32Array` | Convolution kernel. |

---

### `convolution`

Adaptive 1-D convolution that selects the most efficient algorithm based on kernel size:

- **Kernel ≤ 1024 samples** — single GPU pass.
- **Kernel 1025–8192** — chunked GPU passes with additive blending.
- **Kernel > 8192** — FFT-based convolution.

```javascript
{ convolution: { signal: Float32Array, kernel: Float32Array } }
```

| Param | Type | Description |
|-------|------|-------------|
| `signal` | `Float32Array` | Input signal. |
| `kernel` | `Float32Array` | Convolution kernel. |

---

## Worked Example: Histogram Layer

The built-in `histogram` layer type demonstrates the full pattern. Relevant excerpt from its `createLayer`:

```javascript
// Normalize source data to [0, 1] for histogram bins
const normalized = new Float32Array(srcV.length)
for (let i = 0; i < srcV.length; i++) {
  normalized[i] = (srcV[i] - min) / range
}

// Build count attribute:
// - No filter: plain histogram texture
// - With filter: filteredHistogram, recomputes when filter axis domain changes
const countAttr = filterQK
  ? { filteredHistogram: { input: normalized, filterValues: srcF, filterAxisId: filterQK, bins } }
  : { histogram: { input: normalized, bins } }

return [{
  attributes: {
    a_corner,          // per-vertex Float32Array (quad corners 0–3)
    x_center,          // per-instance Float32Array (bin centre positions)
    count: countAttr,  // computed attribute — histogram or filtered histogram
  },
  attributeDivisors: { x_center: 1 },
  vertexCount:  4,
  instanceCount: bins,
  primitive: "triangle strip",
  // ...
}]
```

The `count` attribute is sampled in the vertex shader as an ordinary `float`:

```glsl
attribute float a_corner;
attribute float x_center;
attribute float count;     // sampled from the histogram texture at a_pickId

uniform float u_binHalfWidth;
uniform vec2  xDomain, yDomain;

void main() {
  float side = mod(a_corner, 2.0);
  float top  = floor(a_corner / 2.0);
  float bx   = x_center + (side * 2.0 - 1.0) * u_binHalfWidth;
  float by   = top * count;  // count == 0 for bottom corners, histogram value for top
  // ...
}
```
