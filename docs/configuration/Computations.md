# Computations

Gladly provides two types of computations:
1. **Computed Attributes** — used within layer parameters to transform data on the GPU
2. **Computed Data (Transforms)** — used in `config.transforms` to pre-compute data for layers

Both are referenced by name in expression objects.

---

## Computed Attributes

Computed attributes transform data columns within layer parameters. They run on the GPU and can be used wherever an expression is accepted.

### Usage

```javascript
{ points: { xData: { histogram: { input: "raw_data", bins: 50 } } } }
```

### Available Computations

#### histogram

Computes a histogram texture from input data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `bins` | number | no | Number of bins (default: auto) |

---

#### filteredHistogram

Computes a histogram that automatically updates when a filter axis changes. Used internally by the `histogram` layer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column (normalized to [0,1]) |
| `filterValues` | expression | yes | Raw filter column values |
| `filterAxisId` | string | yes | Quantity kind of the filter axis |
| `bins` | number | no | Number of bins |

---

#### kde

Kernel density estimation — smooths a histogram into a continuous density estimate.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `bins` | number | no | Number of output bins |
| `bandwidth` | number | no | Gaussian sigma in bins (default: 5) |

---

#### filter1D

Generic 1D convolution filter.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `kernel` | expression | yes | 1D kernel weights |

---

#### lowPass

Low-pass filter (Gaussian smoothing).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `sigma` | number | no | Gaussian sigma (default: 3) |
| `kernelSize` | number | no | Kernel size (auto if omitted) |

---

#### highPass

High-pass filter (original minus low-pass).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `sigma` | number | no | Gaussian sigma (default: 3) |
| `kernelSize` | number | no | Kernel size (auto if omitted) |

---

#### bandPass

Band-pass filter (difference of two low-pass filters).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | expression | yes | Input data column |
| `sigmaLow` | number | yes | Lower frequency cutoff (sigma) |
| `sigmaHigh` | number | yes | Upper frequency cutoff (sigma) |

---

#### convolution

Adaptive convolution with automatic kernel sizing based on data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `signal` | expression | yes | Input signal column |
| `kernel` | expression | yes | Convolution kernel column |

---

#### fftConvolution

FFT-based convolution for large signals.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `signal` | expression | yes | Input signal column |
| `kernel` | expression | yes | Convolution kernel column |

---

#### linspace

Generates linearly spaced values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | number | yes | Start value |
| `stop` | number | yes | Stop value |
| `num` | number | yes | Number of samples |

---

#### range

Generates a range of integer values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | number | yes | Start value |
| `stop` | number | yes | Stop value (exclusive) |
| `step` | number | no | Step size (default: 1) |

---

#### random

Generates random values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `num` | number | yes | Number of samples |
| `min` | number | no | Minimum value (default: 0) |
| `max` | number | no | Maximum value (default: 1) |

---

## Computed Data (Transforms)

Transforms pre-compute data before layers render. They are specified in `config.transforms` and produce new data columns accessible via `data.transformName.columnName`.

### Usage

```javascript
config: {
  transforms: [
    {
      name: "histogram",
      HistogramData: {
        input: "temperature",
        bins: 50,
        filter: "depth"
      }
    }
  ]
}
```

Then access via `data.histogram.binCenters` and `data.histogram.counts`.

### Available Transforms

#### HistogramData

Computes a histogram with bin centers and counts. Supports reactive filtering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | string | yes | Input data column name |
| `bins` | integer | no | Number of bins (0 for auto) |
| `filter` | expression | no | Filter column — registers a filter axis |

**Output columns:**
- `binCenters` — bin center positions in data space
- `counts` — count per bin

---

#### FftData

Computes Fast Fourier Transform with real and imaginary outputs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | string | yes | Input signal column name |
| `inverse` | boolean | no | Perform inverse FFT (default: false) |

**Output columns:**
- `real` — real component
- `imag` — imaginary component
- `magnitude` — magnitude (computed)
- `phase` — phase (computed)

---

#### ElementwiseData

Performs element-wise operations on multiple columns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataLength` | integer | no | Override output length (auto-detected) |
| `columns` | array | yes | Array of column mappings |

Each column mapping has:
| Property | Type | Description |
|----------|------|-------------|
| `dst` | string | Output column name |
| `src` | computed attribute expression | Input expression — see [Computed Attribute expressions](#computed-attributes) below |

**Output columns:**
- Defined by `columns` parameter

---

## Expression Syntax

Expressions can be:

1. **Plain column name** (string):
   ```javascript
   xData: "temperature"
   ```

2. **Computed attribute** (object with single key):
   ```javascript
   xData: { histogram: { input: "raw", bins: 50 } }
   ```

3. **Computed data** (transform output):
   ```javascript
   xData: "histogram.binCenters"  // after transform named "histogram"
   ```

4. **Transform specification** (object in `config.transforms`):
   ```javascript
   config: {
     transforms: [
       { name: "myHist", HistogramData: { input: "data", bins: 20 } }
     ]
   }
   // Results in data.myHist.binCenters and data.myHist.counts
   ```
