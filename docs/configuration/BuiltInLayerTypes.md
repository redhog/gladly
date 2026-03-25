# Built-in Layer Types

Gladly includes several built-in layer types for common visualization tasks. Each layer type is registered by name and configured via parameters passed in the layer specification.

For writing custom layer types see [Writing Layer Types](../extension-api/LayerTypes.md).

---

## points

A scatter plot that renders individual points coloured by a per-point value mapped through a colorscale.

**Auto-registered** on import of `PointsLayer.js`. `pointsLayerType` is also exported if you need the `LayerType` object directly (e.g. to inspect its schema).

```javascript
{ points: { xData: "temperature", yData: "pressure", vData: "humidity" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | expression | yes | — | Data key for x coordinates; also used as the x-axis quantity kind |
| `yData` | expression | yes | — | Data key for y coordinates; also used as the y-axis quantity kind |
| `vData` | expression | no | — | Data key for primary color values; also used as the color axis quantity kind. If omitted, points are drawn black |
| `vData2` | expression | no | — | Data key for secondary color values for 2D colorscale mapping. If omitted with `vData` present, uses 1D colorscale |
| `fData` | expression | no | `none` | Data key for filter values (points outside filter range are hidden) |
| `xAxis` | string | no | `"xaxis_bottom"` | x-axis position |
| `yAxis` | string | no | `"yaxis_left"` | y-axis position |

### Behavior

- Point size: 4.0 px
- Uses [`Data.wrap`](../user-api/Data.md#datawrapdata) internally, so it accepts flat `{ col: Float32Array }` objects, per-column rich objects, and the columnar format — any of the three formats described in the `Data` reference
- Spatial quantity kinds: taken from the data's `quantity_kind` metadata for the named column if present; otherwise the column name itself
- Color axis quantity kind: same resolution for `vData`; the key in `config.axes` must match the resolved quantity kind
- Colorscale: from `config.axes[quantityKind].colorscale`, or the quantity kind registry
- Supports log scales on all axes via `config.axes[...].scale: "log"`

### Example (simple flat format)

```javascript
plot.update({
  data: { x, y, temperature },
  config: {
    layers: [
      { points: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

### Example (columnar format with quantity kinds)

When the data carries `quantity_kinds`, the resolved quantity kind — not the column name — is used as the axis key in `config.axes`:

```javascript
plot.update({
  data: {
    data: { x, y, temperature },
    quantity_kinds: { x: "distance_m", y: "voltage_V", temperature: "temperature_K" }
  },
  config: {
    layers: [
      { points: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      // key is the resolved quantity kind, not the column name "temperature"
      temperature_K: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

---

## lines

A connected-line plot that renders segments between consecutive points, with per-point color mapped through a colorscale. Uses instanced rendering: segment endpoints are uploaded once as per-instance data and a two-vertex template is replicated for each segment.

**Auto-registered** on import of `LinesLayer.js`. `linesLayerType` is also exported if you need the `LayerType` object directly.

```javascript
{ lines: { xData: "time", yData: "temperature", vData: "humidity", lineColorMode: "gradient" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | expression | yes | — | Data key for x coordinates |
| `yData` | expression | yes | — | Data key for y coordinates |
| `vData` | expression | no | — | Data key for primary color values. If omitted, lines are drawn black |
| `vData2` | expression | no | — | Data key for secondary color values for 2D colorscale mapping |
| `fData` | expression | no | `none` | Data key for filter values |
| `lineSegmentIdData` | expression | no | — | Column of segment IDs; only consecutive points sharing the same ID are connected. Segments with mismatched IDs produce a zero-length degenerate line that the rasterizer discards |
| `lineColorMode` | string | no | `"gradient"` | `"gradient"` — color interpolated linearly along each segment; `"midpoint"` — each half of the segment uses the color of the nearest endpoint |
| `lineWidth` | number | no | `1.0` | Line width in pixels (browsers typically clamp values above 1) |
| `xAxis` | string | no | `"xaxis_bottom"` | x-axis position |
| `yAxis` | string | no | `"yaxis_left"` | y-axis position |

### Behavior

- Uses instanced rendering: one instance per segment (N−1 instances for N points)
- Segment boundary handling: when `lineSegmentIdData` is used and two adjacent points have different IDs, both template vertices collapse to the same position, producing a zero-length segment the rasterizer discards
- Same quantity kind resolution as `points`

### Example

```javascript
plot.update({
  data: { x, y, temperature },
  config: {
    layers: [
      { lines: { xData: "x", yData: "y", vData: "temperature", lineColorMode: "gradient" } }
    ],
    axes: {
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

---

## bars

Renders bar charts with configurable bin positions and heights.

**Auto-registered** on import. `barsLayerType` is also exported if needed.

```javascript
{ bars: { xData: "category", yData: "count", color: [0.2, 0.5, 0.8, 1.0] } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xData` | string | yes | — | Column name for bin center positions |
| `yData` | string | yes | — | Column name for bar lengths (counts) |
| `orientation` | string | no | `"vertical"` | `"vertical"`: bins on x-axis, bars extend up; `"horizontal"`: bins on y-axis, bars extend right |
| `color` | array | no | `[0.2, 0.5, 0.8, 1.0]` | Bar color as `[R, G, B, A]` in [0, 1] |
| `xAxis` | string | no | `"xaxis_bottom"` | x-axis position |
| `yAxis` | string | no | `"yaxis_left"` | y-axis position |

When `orientation` is `"horizontal"`, the quantity kinds are swapped: `xData`'s quantity kind is bound to `yAxis` (bin positions) and `yData`'s quantity kind is bound to `xAxis` (bar lengths). This is the correct wiring for a sideways histogram sharing its position axis with an adjacent scatter plot.

---

## tile

A geographic map underlay that fetches and renders raster tiles from XYZ, WMS, or WMTS services. Tiles are reprojected from the tile service's CRS to the plot's CRS using tessellated meshes, so any pair of projected coordinate systems is supported. proj4 definitions are fetched automatically from [epsg.io](https://epsg.io) on first use; quantity kind labels are looked up from the `projnames` package.

**Auto-registered** on import. `tileLayerType` and `TileLayerType` are also exported if needed.

```javascript
{ tile: { source: { xyz: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" } }, plotCrs: "EPSG:3857" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | object | yes | — | Tile source object — see source types below |
| `tileCrs` | string | no | `"EPSG:3857"` | CRS of the tile service |
| `plotCrs` | string | no | same as `tileCrs` | CRS of the plot axes. When it differs from `tileCrs`, each tile is tessellated and reprojected |
| `tessellation` | integer | no | `8` | Grid resolution (N×N quads per tile) used when reprojecting. Higher values give more accurate curves at the cost of more vertices |
| `opacity` | number | no | `1.0` | Tile opacity, 0–1 |
| `xAxis` | string | no | `"xaxis_bottom"` | x-axis to use |
| `yAxis` | string | no | `"yaxis_left"` | y-axis to use |

### Source types

`source.type: "xyz"` — Standard slippy-map tiles (OpenStreetMap, Mapbox, etc.)

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | URL template with `{z}`, `{x}`, `{y}`, and optional `{s}` placeholders |
| `subdomains` | no | `["a","b","c"]` | Subdomain letters substituted for `{s}` |
| `minZoom` | no | `0` | Minimum zoom level |
| `maxZoom` | no | `19` | Maximum zoom level |

`source.type: "wms"` — OGC Web Map Service. Fetches a single image per viewport change.

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | WMS service base URL |
| `layers` | yes | — | Comma-separated layer names |
| `format` | no | `"image/png"` | Image format |
| `version` | no | `"1.3.0"` | WMS version (`"1.1.1"` or `"1.3.0"`) |
| `crs` | no | `tileCrs` | CRS for the `GetMap` request |
| `styles` | no | — | Comma-separated style names |
| `transparent` | no | `true` | Request transparent background |

`source.type: "wmts"` — OGC Web Map Tile Service. Uses the same Web Mercator tile grid as XYZ.

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | yes | — | Base URL — either a RESTful template (with `{TileMatrix}`, `{TileRow}`, `{TileCol}` or `{z}`, `{x}`, `{y}`) or a KVP endpoint |
| `layer` | yes | — | Layer identifier |
| `style` | no | `"default"` | Style identifier |
| `format` | no | `"image/png"` | Image format |
| `tileMatrixSet` | no | `"WebMercatorQuad"` | Tile matrix set identifier |
| `minZoom` | no | `0` | Minimum zoom level |
| `maxZoom` | no | `19` | Maximum zoom level |

### Behavior

- Tiles are loaded asynchronously; the plot renders other layers immediately and tiles appear as they arrive
- Tile textures are cached (up to 50 tiles for XYZ/WMTS; WMS keeps only the current and previous image)
- A new tile load is triggered when the visible domain shifts or zooms by more than ~2%
- EPSG quantity kinds (`epsg_CODE_x` / `epsg_CODE_y`) are registered automatically using `projnames` labels when a new CRS code is first encountered, so axis labels are populated without any user setup
- proj4 definitions for EPSG:4326 (WGS84) and EPSG:3857 (Web Mercator) are built-in; all others are fetched from `https://epsg.io/{code}.proj4` on first use. For offline use, pre-register with [`registerEpsgDef`](../user-api/Registries.md#registerepsgdefepsgcode-proj4string)
- The tile layer contributes no domain data — axis bounds must come from other layers or explicit `axes.min`/`max` config
- Alpha blending is enabled; use `opacity` for transparent overlays

### Example — OSM tiles reprojected from Web Mercator to WGS84 lon/lat

```javascript
import { Plot, registerAxisQuantityKind } from 'gladly-plot'

registerAxisQuantityKind('city_index', { label: 'City', scale: 'linear', colorscale: 'plasma' })

const lon     = new Float32Array([-74.006, -0.118, 139.691])
const lat     = new Float32Array([ 40.714, 51.509,  35.690])
const cityIdx = new Float32Array([0, 1, 2])

const data = {
  data: { lon, lat, cityIdx },
  quantity_kinds: { lon: 'epsg_4326_x', lat: 'epsg_4326_y', cityIdx: 'city_index' },
}

plot.update({
  config: {
    layers: [
      {
        tile: {
          source: {
            type: 'xyz',
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          },
          tileCrs: 'EPSG:3857',
          plotCrs: 'EPSG:4326',
          opacity: 0.9,
        },
      },
      { points: { xData: 'lon', yData: 'lat', vData: 'cityIdx' } },
    ],
    axes: {
      xaxis_bottom: { min: -180, max: 180 },
      yaxis_left:   { min: -80,  max: 80  },
      city_index:   { colorbar: 'vertical', colorscale: 'plasma', min: 0, max: 2 },
    },
  },
  data,
})
```

### Example — WMS service

```javascript
plot.update({
  config: {
    layers: [
      {
        tile: {
          source: {
            type: 'wms',
            url: 'https://example.com/wms',
            layers: 'MyLayer',
            format: 'image/png',
            version: '1.3.0',
          },
          tileCrs: 'EPSG:3857',
          plotCrs: 'EPSG:26911',   // NAD83 / UTM zone 11N — fetched automatically
        },
      },
    ],
    axes: {
      xaxis_bottom: { min: 400000, max: 700000 },
      yaxis_left:   { min: 3700000, max: 4000000 },
    },
  },
  data: {},
})
```

---

## colorbar

A layer type that fills the entire plot canvas with a color gradient. Used internally by [`Colorbar`](../user-api/Widgets.md#colorbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `colorbarLayerType` is also exported if you need the `LayerType` object directly.

```javascript
{ colorbar: { colorAxis: "temperature", orientation: "horizontal" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `colorAxis` | string | yes | — | Quantity kind of the color axis to display |
| `orientation` | string | no | `"horizontal"` | `"horizontal"` or `"vertical"` — direction the gradient runs |

### Behavior

- Renders a triangle-strip quad that fills the entire canvas with a color gradient
- Horizontal: gradient runs left → right; vertical: bottom → top
- The spatial axis of the plot (x for horizontal, y for vertical) is bound to the color axis quantity kind, so the axis tick labels show actual data values
- The color axis range and colorscale are sourced from the owning plot's color axis registry

**Typical use:** Create a standalone `Plot` with one `colorbar` layer, link its spatial axis to the color axis of a data plot. The [`Colorbar`](../user-api/Widgets.md#colorbar) class does exactly this.

---

## colorbar2d

A layer type that renders a 2D (bivariate) colorbar gradient. Used internally by [`Colorbar2d`](../user-api/Widgets.md#colorbar2d), but can also be used directly in custom plot setups.

**Auto-registered** on import. `colorbar2dLayerType` is also exported if needed.

```javascript
{ colorbar2d: { xAxis: "temperature", yAxis: "humidity" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xAxis` | string | yes | — | Quantity kind for the x axis (color axis A) |
| `yAxis` | string | yes | — | Quantity kind for the y axis (color axis B) |

### Behavior

- Renders a quad that fills the entire canvas with a 2D colorscale gradient
- The spatial axes of the plot are bound to both color axis quantity kinds, so axis tick labels show actual data values
- See [Colorscales](Colorscales.md) for available 2D colorscales

---

## filterbar

A layer type that registers a filter axis for axis-display purposes without rendering any geometry. Used internally by [`Filterbar`](../user-api/Widgets.md#filterbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `filterbarLayerType` is also exported if you need the `LayerType` object directly.

```javascript
{ filterbar: { filterAxis: "depth", orientation: "horizontal" } }
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filterAxis` | string | yes | — | Quantity kind of the filter axis to display |
| `orientation` | string | no | `"horizontal"` | `"horizontal"` or `"vertical"` — which spatial axis to bind |

### Behavior

- Registers the named filter axis with the plot (so it is accessible via `plot.axes[name]` and can be linked via `linkAxes`)
- Renders no geometry (`vertexCount: 0`)
- Binds the spatial axis (x for horizontal, y for vertical) to the filter axis quantity kind, so tick labels show the filter range

The [`Filterbar`](../user-api/Widgets.md#filterbar) class wraps a plot using this layer type and adds interactive UI (∞ checkboxes for open bounds, zoom/pan to adjust the filter range).

---

## Expression Types

Several parameters accept **expressions** — either a plain data column name (string), a computed attribute, or a transform output:

```javascript
// Plain column
xData: "temperature"

// Computed attribute — transforms a single column, same length
xData: { histogram: { input: "raw_data", bins: 50 } }

// Transform output — result of a transform in config.transforms
xData: "histogram.binCenters"
```

See [Computations](Computations.md) for details on available computations and transforms.
