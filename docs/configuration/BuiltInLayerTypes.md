# Built-in Layer Types

Gladly includes several built-in layer types for common visualization tasks. Each layer type is registered by name and configured via parameters passed in the layer specification.

---

## points

Renders data points as individual markers. Supports 1D or 2D coloring, and optional filtering.

```javascript
{ points: { xData: "temperature", yData: "pressure", vData: "humidity" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | expression | yes | — | Key in `data` for x coordinates |
| `yData` | expression | yes | — | Key in `data` for y coordinates |
| `vData` | expression | no | `none` | Key in `data` for 1D color values (quantity kind determines color axis) |
| `vData2` | expression | no | `none` | Key in `data` for 2D color values (used with vData for bivariate coloring) |
| `fData` | expression | no | `none` | Key in `data` for filter values (points outside filter range are hidden) |
| `xAxis` | string | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | Which y-axis to use |

---

## lines

Renders line segments connecting sequential data points. Supports per-vertex coloring with gradient or midpoint modes.

```javascript
{ lines: { xData: "time", yData: "temperature", vData: "humidity", lineColorMode: "gradient" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | expression | yes | — | Key in `data` for x coordinates |
| `yData` | expression | yes | — | Key in `data` for y coordinates |
| `vData` | expression | no | `none` | Key in `data` for 1D color values |
| `vData2` | expression | no | `none` | Key in `data` for 2D color values |
| `fData` | expression | no | `none` | Key in `data` for filter values |
| `lineSegmentIdData` | expression | no | `none` | Column identifying line segments (consecutive equal values form a segment) |
| `lineColorMode` | string | no | `"gradient"` | `"gradient"` interpolates color along line; `"midpoint"` uses each endpoint's color up to segment center |
| `lineWidth` | number | no | `1.0` | Line width in pixels (browsers may clamp values above 1) |
| `xAxis` | string | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | Which y-axis to use |

---

## bars

Renders bar charts with configurable bin positions and heights.

```javascript
{ bars: { xData: "category", yData: "count", color: [0.2, 0.5, 0.8, 1.0] } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | string | yes | — | Column name for bin center x positions |
| `yData` | string | yes | — | Column name for bar heights (counts) |
| `color` | array | no | `[0.2, 0.5, 0.8, 1.0]` | Bar color as `[R, G, B, A]` in [0, 1] |
| `xAxis` | string | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | Which y-axis to use |

---

## histogram

Renders a histogram with optional filtering. Uses GPU-accelerated binning via the `histogram` or `filteredHistogram` texture computation.

```javascript
{ histogram: { vData: "temperature", filterColumn: "depth", bins: 50 } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vData` | string | yes | — | Data column to histogram |
| `filterColumn` | string | yes | — | Data column used to filter points via its filter axis, or `"none"` |
| `bins` | integer | no | auto | Number of bins (auto-selected by sqrt rule if omitted) |
| `color` | array | no | `[0.2, 0.5, 0.8, 1.0]` | Bar color as `[R, G, B, A]` in [0, 1] |
| `xAxis` | string | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | Which y-axis to use |

---

## tile

Renders map tiles from XYZ, WMS, or WMTS tile services. Supports CRS reprojection.

```javascript
{ tile: { source: { xyz: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" } }, plotCrs: "EPSG:3857" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | object | yes | — | Tile source configuration (exactly one of `xyz`, `wms`, or `wmts`) |
| `source.xyz.url` | string | for xyz | — | URL template with `{z}`, `{x}`, `{y}`, optional `{s}` placeholders |
| `source.xyz.subdomains` | array | no | `["a", "b", "c"]` | Subdomain letters for `{s}` |
| `source.xyz.minZoom` | integer | no | `0` | Minimum zoom level |
| `source.xyz.maxZoom` | integer | no | `19` | Maximum zoom level |
| `source.wms.url` | string | for wms | — | WMS service base URL |
| `source.wms.layers` | string | for wms | — | Comma-separated layer names |
| `source.wms.styles` | string | no | `""` | Comma-separated style names |
| `source.wms.format` | string | no | `"image/jpeg"` | Image format |
| `source.wms.version` | string | no | `"1.1.1"` | WMS version (`"1.1.1"` or `"1.3.0"`) |
| `source.wms.transparent` | boolean | no | `false` | Enable transparency |
| `source.wmts.url` | string | for wmts | — | WMTS base URL |
| `source.wmts.layer` | string | for wmts | — | Layer name |
| `source.wmts.style` | string | no | `"default"` | Style name |
| `source.wmts.format` | string | no | `"image/jpeg"` | Image format |
| `source.wmts.tileMatrixSet` | string | no | `"GoogleMapsCompatible"` | Tile matrix set |
| `source.wmts.minZoom` | integer | no | `0` | Minimum zoom level |
| `source.wmts.maxZoom` | integer | no | `19` | Maximum zoom level |
| `tileCrs` | string | no | `"EPSG:3857"` | CRS of the tile service |
| `plotCrs` | string | no | `tileCrs` | CRS of the plot axes |
| `tessellation` | integer | no | `8` | Grid resolution (N×N quads per tile) for reprojection accuracy |
| `opacity` | number | no | `1.0` | Layer opacity in [0, 1] |
| `xAxis` | string | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | Which y-axis to use |

---

## colorbar

Renders a 1D colorbar gradient. Typically created automatically via `config.axes` or `config.colorbars`.

```javascript
{ colorbar: { colorAxis: "temperature", orientation: "horizontal" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `colorAxis` | string | yes | — | Quantity kind of the color axis to display |
| `orientation` | string | no | `"horizontal"` | `"horizontal"` or `"vertical"` |

---

## colorbar2d

Renders a 2D (bivariate) colorbar. Typically created automatically via `config.colorbars`.

```javascript
{ colorbar2d: { xAxis: "temperature", yAxis: "humidity" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xAxis` | string | yes | — | Quantity kind for the x axis (color axis A) |
| `yAxis` | string | yes | — | Quantity kind for the y axis (color axis B) |

---

## filterbar

Renders a filterbar for interactive filtering. Typically created automatically via `config.axes`.

```javascript
{ filterbar: { filterAxis: "depth", orientation: "horizontal" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filterAxis` | string | yes | — | Quantity kind of the filter axis to display |
| `orientation` | string | no | `"horizontal"` | `"horizontal"` or `"vertical"` |

---

## Expression Types

Several parameters accept **expressions** — either a plain data column name (string) or a computed attribute:

```javascript
// Plain column
xData: "temperature"

// Computed attribute
xData: { histogram: { input: "raw_data", bins: 50 } }
```

See [Computations](Computations.md) for details on available computations.
