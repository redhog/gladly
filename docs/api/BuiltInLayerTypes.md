# Built-in Layer Types

Gladly ships four pre-registered layer types. For writing custom layer types see [Writing Layer Types](LayerTypes.md).

---

## `scatter`

A scatter plot that renders points coloured by a per-point value mapped through a colorscale.

**Auto-registered** on import. `scatterLayerType` is also exported if you need the `LayerType` object directly (e.g. to inspect its schema).

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `xData` | yes | — | Data key for x coordinates; also used as the x-axis quantity kind |
| `yData` | yes | — | Data key for y coordinates; also used as the y-axis quantity kind |
| `vData` | yes | — | Data key for color values; also used as the color axis quantity kind |
| `xAxis` | no | `"xaxis_bottom"` | x-axis position |
| `yAxis` | no | `"yaxis_left"` | y-axis position |

**Behavior:**
- Point size: 4.0 px
- Uses [`Data.wrap`](Reference.md#data) internally, so it accepts flat `{ col: Float32Array }` objects, per-column rich objects, and the columnar format — any of the three formats described in the `Data` reference
- Spatial quantity kinds: taken from the data's `quantity_kind` metadata for the named column if present; otherwise the column name itself
- Color axis quantity kind: same resolution for `vData`; the key in `config.axes` must match the resolved quantity kind
- Colorscale: from `config.axes[quantityKind].colorscale`, or the quantity kind registry
- Supports log scales on all axes via `config.axes[...].scale: "log"`

**Example (simple flat format):**

```javascript
plot.update({
  data: { x, y, temperature },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

**Example (columnar format with quantity kinds):**

When the data carries `quantity_kinds`, the resolved quantity kind — not the column name — is used as the axis key in `config.axes`:

```javascript
plot.update({
  data: {
    data: { x, y, temperature },
    quantity_kinds: { x: "distance_m", y: "voltage_V", temperature: "temperature_K" }
  },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      // key is the resolved quantity kind, not the column name "temperature"
      temperature_K: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

---

## `tile`

A geographic map underlay that fetches and renders raster tiles from XYZ, WMS, or WMTS services. Tiles are reprojected from the tile service's CRS to the plot's CRS using tessellated meshes, so any pair of projected coordinate systems is supported. proj4 definitions are fetched automatically from [epsg.io](https://epsg.io) on first use; quantity kind labels are looked up from the `projnames` package.

**Auto-registered** on import. `tileLayerType` and `TileLayerType` are also exported if needed.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `source` | yes | — | Tile source object — see source types below |
| `tileCrs` | no | `"EPSG:3857"` | CRS of the tile service |
| `plotCrs` | no | same as `tileCrs` | CRS of the plot axes. When it differs from `tileCrs`, each tile is tessellated and reprojected |
| `tessellation` | no | `8` | Grid resolution (N×N quads per tile) used when reprojecting. Higher values give more accurate curves at the cost of more vertices |
| `opacity` | no | `1.0` | Tile opacity, 0–1 |
| `xAxis` | no | `"xaxis_bottom"` | x-axis to use |
| `yAxis` | no | `"yaxis_left"` | y-axis to use |

**Source types:**

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

**Behavior:**
- Tiles are loaded asynchronously; the plot renders other layers immediately and tiles appear as they arrive
- Tile textures are cached (up to 50 tiles for XYZ/WMTS; WMS keeps only the current and previous image)
- A new tile load is triggered when the visible domain shifts or zooms by more than ~2%
- EPSG quantity kinds (`epsg_CODE_x` / `epsg_CODE_y`) are registered automatically using `projnames` labels when a new CRS code is first encountered, so axis labels are populated without any user setup
- proj4 definitions for EPSG:4326 (WGS84) and EPSG:3857 (Web Mercator) are built-in; all others are fetched from `https://epsg.io/{code}.proj4` on first use. For offline use, pre-register with [`registerEpsgDef`](Reference.md#registerepsgdef)
- The tile layer contributes no domain data — axis bounds must come from other layers or explicit `axes.min`/`max` config
- Alpha blending is enabled; use `opacity` for transparent overlays

**Example — OSM tiles reprojected from Web Mercator to WGS84 lon/lat:**

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
      { scatter: { xData: 'lon', yData: 'lat', vData: 'cityIdx' } },
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

**Example — WMS service:**

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

## `colorbar`

A layer type that fills the entire plot canvas with a color gradient. Used internally by [`Colorbar`](ColorbarsAndFilterbars.md#colorbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `colorbarLayerType` is also exported if you need the `LayerType` object directly.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `colorAxis` | yes | — | Quantity kind of the color axis to display |
| `orientation` | no | `"horizontal"` | `"horizontal"` or `"vertical"` — direction the gradient runs |

**Behavior:**
- Renders a triangle-strip quad that fills the entire canvas with a color gradient
- Horizontal: gradient runs left → right; vertical: bottom → top
- The spatial axis of the plot (x for horizontal, y for vertical) is bound to the color axis quantity kind, so the axis tick labels show actual data values
- The color axis range and colorscale are sourced from the owning plot's color axis registry

**Typical use:** Create a standalone `Plot` with one `colorbar` layer, link its spatial axis to the color axis of a data plot. The [`Colorbar`](ColorbarsAndFilterbars.md#colorbar) class does exactly this.

---

## `filterbar`

A layer type that registers a filter axis for axis-display purposes without rendering any geometry. Used internally by [`Filterbar`](ColorbarsAndFilterbars.md#filterbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `filterbarLayerType` is also exported if you need the `LayerType` object directly.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `filterAxis` | yes | — | Quantity kind of the filter axis to display |
| `orientation` | no | `"horizontal"` | `"horizontal"` or `"vertical"` — which spatial axis to bind |

**Behavior:**
- Registers the named filter axis with the plot (so it is accessible via `plot.axes[name]` and can be linked via `linkAxes`)
- Renders no geometry (`vertexCount: 0`)
- Binds the spatial axis (x for horizontal, y for vertical) to the filter axis quantity kind, so tick labels show the filter range

The [`Filterbar`](ColorbarsAndFilterbars.md#filterbar) class wraps a plot using this layer type and adds interactive UI (∞ checkboxes for open bounds, zoom/pan to adjust the filter range).
