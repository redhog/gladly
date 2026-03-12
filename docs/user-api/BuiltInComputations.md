# Built-in Computations

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

### `linspace`

Generates `length` evenly-spaced values in the open interval `]0, 1[`. Value at index `i` is `(i + 0.5) / length`. Computed on the CPU.

```javascript
{ linspace: { length: 1000 } }
```

| Param | Type | Description |
|-------|------|-------------|
| `length` | integer | Number of values to generate. |

Useful for parametric curves, colour gradients, or any layer that needs a uniform `[0, 1]` parameter per point.

---

### `range`

Generates `length` integer values `0.0, 1.0, 2.0, …, length − 1` as floats. Computed on the CPU.

```javascript
{ range: { length: 1000 } }
```

| Param | Type | Description |
|-------|------|-------------|
| `length` | integer | Number of values to generate. |

Useful as a plain index column, e.g. for mapping sample positions along a time axis.

---

### `random`

Generates `length` pseudorandom values in the open interval `]0, 1[`. **All computation is done on the GPU** via a fullscreen quad render pass — no JavaScript loops over data. The output is deterministic for a given `(length, seed)` pair and is consistent across renders.

Uses a 3-round xorshift-multiply hash: each value is derived from `hash(index XOR seed)`.

```javascript
{ random: { length: 1000, seed?: number } }
```

| Param | Type | Description |
|-------|------|-------------|
| `length` | integer | Number of values to generate. |
| `seed` | integer (optional) | Integer seed. Default `0`, which picks a random seed via `Math.random()` at column-creation time, producing a different sequence each time the column is created but a stable sequence across re-renders. |

---

### `glslExpr`

A user-defined GLSL computation. The expression is a raw GLSL string with `{name}` placeholders that are substituted with the resolved GLSL expressions for each named input. Registered as a GLSL computation, so it composes without a GPU render pass (the expression is inlined directly into the vertex shader).

```javascript
{
  glslExpr: {
    expr: 'sin({x}) * {amplitude}',
    inputs: {
      x:         'timeColumn',
      amplitude: { linspace: { length: 1000 } }
    }
  }
}
```

| Param | Type | Description |
|-------|------|-------------|
| `expr` | string | A GLSL `float` expression. Reference inputs using `{name}` placeholders. |
| `inputs` | object (optional) | Named inputs: each value is any expression (column name, computation, etc.). Each placeholder `{name}` in `expr` is replaced with the resolved GLSL sampling expression for that input. |

Because `glslExpr` is a `GlslComputation`, the expression is injected directly into the vertex shader rather than materialised into a texture, making it zero-overhead for arithmetic transformations.
