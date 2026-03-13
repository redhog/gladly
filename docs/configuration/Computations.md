# Computations

Gladly provides two types of computations for transforming data:

1. **Computed attributes** — transform a single column into a new column of the same length
2. **Transforms** — transform an entire dataset into a new dataset (possibly with different length and columns)

---

## Computed Attributes

A computed attribute transforms a single column into a new column with the **same length** but different values. It runs on the GPU and can be used wherever an expression is accepted in layer parameters.

**Use case:** Applying a mathematical function to every value in a column, e.g., computing a histogram, smoothing with a kernel, normalizing, etc.

### Usage

```javascript
{ points: { xData: { histogram: { input: "raw_data", bins: 50 } } } }
```

### Available Computed Attributes

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

## Transforms

A transform transforms an entire dataset into a new dataset. The output can have a **different length** and **different columns** than the input. Transforms are specified in `config.transforms` and produce new data columns accessible via `data.transformName.columnName`.

**Use case:** Computing aggregations (histograms, FFTs), creating derived datasets, pre-processing before visualization.

### How Transforms Differ from Computed Attributes

| Aspect | Computed Attribute | Transform |
|--------|-------------------|-----------|
| Output | Single column, same length as input | Entire dataset, possibly different length and columns |
| Specification | Inline in layer parameters | In `config.transforms` array |
| Access | Used directly in layer params | Access via `data.transformName.columnName` |
| Example | `vData: { histogram: { input: "x", bins: 50 } }` | `transforms: [{ name: "hist", HistogramData: {...} }]` |

A transform can consist of **multiple computed attributes** if the transform type is elementwise — see `ElementwiseData` below.

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

Performs element-wise operations on multiple columns. A transform that consists of multiple computed attributes — each output column is computed independently from input columns using the same length.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataLength` | integer | no | Override output length (auto-detected) |
| `columns` | array | yes | Array of column mappings |

Each column mapping has:
| Property | Type | Description |
|----------|------|-------------|
| `dst` | string | Output column name |
| `src` | computed attribute expression | Input expression — see computed attributes above |

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

3. **Computed data (transform output)**:
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

For writing custom computations see [Computations](../extension-api/Computations.md).
