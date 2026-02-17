# Writing Layer Types

This page covers how to define and register custom `LayerType` instances. For using layer types in a plot see [Configuring Plots](PlotConfiguration.md). For an overview of the data model see the [main API doc](../API.md).

---

## Overview

A `LayerType` encapsulates everything needed to render one kind of data visualization:

- GLSL vertex and fragment shaders
- Spatial axis **quantity kinds** (for compatibility checking between layers sharing an axis)
- Color axis slot declarations (optional)
- Filter axis slot declarations (optional)
- A JSON Schema describing configuration parameters
- A `createLayer` factory that maps parameters + data → a layer config object

---

## Minimal Example (no color or filter axes)

```javascript
import { LayerType, registerLayerType, AXES } from './src/index.js'

const redDotsType = new LayerType({
  name: "red_dots",
  axisQuantityUnits: { x: "meters", y: "volts" },

  vert: `
    precision mediump float;
    attribute float x, y;
    uniform vec2 xDomain, yDomain;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
    }
  `,

  frag: `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
  `,

  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      xAxis: { type: "string", enum: AXES.filter(a => a.includes("x")), default: "xaxis_bottom" },
      yAxis: { type: "string", enum: AXES.filter(a => a.includes("y")), default: "yaxis_left" }
    },
    required: ["xData", "yData"]
  }),

  createLayer: function(parameters, data) {
    const { xData, yData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData] },
      uniforms: {},
      xAxis,
      yAxis
    }
  }
})

registerLayerType("red_dots", redDotsType)
```

---

## With Color Axes

Color axes map a per-point numeric value to a color via a colorscale. Declare the slot in `colorAxisQuantityKinds` and provide `getColorAxisQuantityKinds` to resolve the quantity kind dynamically:

```javascript
import { LayerType, registerLayerType, AXES } from './src/index.js'

const heatDotsType = new LayerType({
  name: "heat_dots",
  axisQuantityUnits: { x: "meters", y: "volts" },

  // Declare color slot "v"; null = quantity kind resolved per-layer
  colorAxisQuantityKinds: { v: null },

  vert: `
    precision mediump float;
    attribute float x, y, v;
    uniform vec2 xDomain, yDomain;
    varying float value;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
      value = v;
    }
  `,

  // map_color() is injected automatically when color axes are present
  frag: `
    precision mediump float;
    uniform int colorscale_v;
    uniform vec2 color_range_v;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale_v, color_range_v, value);
    }
  `,

  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      vData: { type: "string", description: "Data key for color values; becomes the color axis quantity kind" },
      xAxis: { type: "string", enum: AXES.filter(a => a.includes("x")), default: "xaxis_bottom" },
      yAxis: { type: "string", enum: AXES.filter(a => a.includes("y")), default: "yaxis_left" }
    },
    required: ["xData", "yData", "vData"]
  }),

  getColorAxisQuantityKinds: function(parameters) {
    return { v: parameters.vData }
  },

  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], v: data[vData] },
      uniforms: {},
      xAxis,
      yAxis,
      colorAxes: {
        v: {
          quantityKind: vData,      // links to shared color axis
          data: data[vData],        // Float32Array for auto-range calculation
          colorscale: "viridis"     // default; overridable in config.axes
        }
      }
    }
  }
})

registerLayerType("heat_dots", heatDotsType)
```

**Usage:**
```javascript
plot.update({
  data: { x, y, temperature },
  config: {
    layers: [
      { heat_dots: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

---

## With Filter Axes

Filter axes discard points whose value falls outside a range. Declare the slot in `filterAxisQuantityKinds`:

```javascript
const filteredDotsType = new LayerType({
  name: "filtered_dots",
  axisQuantityUnits: { x: "meters", y: "meters" },
  filterAxisQuantityKinds: { z: null },

  vert: `
    precision mediump float;
    attribute float x, y, z;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_z;

    void main() {
      // filter_in_range() is injected automatically when filter axes are present
      if (!filter_in_range(filter_range_z, z)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);  // move outside clip space
        return;
      }
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 4.0;
    }
  `,

  frag: `
    precision mediump float;
    void main() { gl_FragColor = vec4(0.0, 0.5, 1.0, 1.0); }
  `,

  schema: () => ({ /* ... */ }),

  getFilterAxisQuantityKinds: function(parameters) {
    return { z: parameters.zData }
  },

  createLayer: function(parameters, data) {
    const { xData, yData, zData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], z: data[zData] },
      uniforms: {},
      xAxis, yAxis,
      filterAxes: {
        z: {
          quantityKind: zData,   // links to shared filter axis
          data: data[zData]      // Float32Array of per-point values to test
        }
      }
    }
  }
})
```

**Usage:**
```javascript
plot.update({
  data: { x, y, depth },
  config: {
    layers: [{ filtered_dots: { xData: "x", yData: "y", zData: "depth" } }],
    axes: {
      depth: { min: 100, max: 800 }  // only show points where 100 ≤ depth ≤ 800
    }
  }
})
```

---

## Combined Color and Filter Axes

```javascript
const filteredScatterType = new LayerType({
  name: "filtered_scatter",
  axisQuantityUnits: { x: null, y: null },
  colorAxisQuantityKinds: { v: null },
  filterAxisQuantityKinds: { z: null },

  vert: `
    precision mediump float;
    attribute float x, y, z, v;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_z;
    varying float value;

    void main() {
      if (!filter_in_range(filter_range_z, z)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 4.0;
      value = v;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale_v;
    uniform vec2 color_range_v;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale_v, color_range_v, value);
    }
  `,

  getAxisQuantityUnits:        (p) => ({ x: p.xData, y: p.yData }),
  getColorAxisQuantityKinds:   (p) => ({ v: p.vData }),
  getFilterAxisQuantityKinds:  (p) => ({ z: p.zData }),

  schema: () => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, zData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], v: data[vData], z: data[zData] },
      uniforms: {},
      xAxis, yAxis,
      colorAxes:  { v: { quantityKind: vData, data: data[vData], colorscale: "viridis" } },
      filterAxes: { z: { quantityKind: zData, data: data[zData] } }
    }
  }
})
```

---

## Dynamic Spatial Axis Quantity Kinds

Set an axis quantity kind to `null` in `axisQuantityUnits` and provide `getAxisQuantityUnits` to resolve it at runtime from parameters or data:

```javascript
const dynamicScatterType = new LayerType({
  name: "dynamic_scatter",
  axisQuantityUnits: { x: null, y: "meters" },  // x resolved dynamically

  getAxisQuantityUnits: function(parameters, data) {
    const xKind = parameters.xUnit || "meters"
    return { x: xKind, y: null }   // y already static; return null to skip override
  },

  schema: () => ({
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      xUnit: {
        type: "string",
        enum: ["meters", "volts", "m/s", "ampere"],
        default: "meters"
      }
    },
    required: ["xData", "yData"]
  }),

  vert: `/* ... */`,
  frag: `/* ... */`,

  createLayer: function(parameters, data) {
    const { xData, yData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData] },
      uniforms: {},
      xAxis, yAxis
    }
  }
})
```

If layers on the same axis have conflicting quantity kinds, an error is thrown during `plot.update()` and the previous configuration is preserved.

---

## Color Axes — Concepts

| Term | Description |
|------|-------------|
| **Slot** | Named position in the layer (e.g. `"v"`). Controls GLSL uniform names: `colorscale_v`, `color_range_v`. |
| **Quantity kind** | String identifier for the color axis (e.g. `"temperature"`). Layers sharing a quantity kind share a common range. |
| **Colorscale** | Named GLSL color function (e.g. `"viridis"`). Set a default in `createLayer`; override via `config.axes`. |

### How the Plot Handles Color Axes

1. Registers each slot's quantity kind with the `ColorAxisRegistry`
2. Scans all layers sharing that quantity kind and calculates the auto range [min, max]
3. Applies any override from `config.axes`
4. Passes `colorscale_<slot>` (int) and `color_range_<slot>` (vec2) as uniforms

### GLSL Integration

When a layer has color axes, `createDrawCommand` automatically:
1. Injects all registered colorscale GLSL functions
2. Injects `map_color(int cs, vec2 range, float value)` dispatch function

```glsl
uniform int colorscale_v;     // colorscale index for slot "v"
uniform vec2 color_range_v;   // [min, max] range for slot "v"
varying float value;

void main() {
  gl_FragColor = map_color(colorscale_v, color_range_v, value);
}
```

---

## Filter Axes — Concepts

| Term | Description |
|------|-------------|
| **Slot** | Named position in the layer (e.g. `"z"`). Controls GLSL uniform name: `filter_range_z`. |
| **Quantity kind** | String identifier (e.g. `"depth"`). Layers sharing a quantity kind share the same filter range. |
| **Open bound** | Missing `min` or `max` in `config.axes` means that bound is not enforced. |

### How the Plot Handles Filter Axes

1. Registers each slot's quantity kind with the `FilterAxisRegistry`
2. Applies `min`/`max` from `config.axes` if present; defaults to fully open bounds
3. Passes `filter_range_<slot>` (vec4: `[min, max, hasMin, hasMax]`) as a uniform

### GLSL Integration

When a layer has filter axes, `createDrawCommand` automatically injects `filter_in_range(vec4, float)`:

```glsl
uniform vec4 filter_range_z;  // [min, max, hasMin, hasMax]
attribute float z;

void main() {
  if (!filter_in_range(filter_range_z, z)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);  // vertex shader discard
    return;
  }
  // ...
}
```

Or in a fragment shader (with z passed as a varying):
```glsl
if (!filter_in_range(filter_range_z, z_value)) discard;
```

---

## API Reference

### `LayerType` Constructor

```javascript
new LayerType({ name, axisQuantityUnits, colorAxisQuantityKinds, filterAxisQuantityKinds,
                vert, frag, schema, createLayer,
                getAxisQuantityUnits, getColorAxisQuantityKinds, getFilterAxisQuantityKinds })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Type identifier (e.g. `"scatter"`) |
| `axisQuantityUnits` | `{x, y}` | Spatial axis quantity kinds. Use `null` for dynamic resolution. |
| `colorAxisQuantityKinds` | object | `{ [slot]: string\|null }`. Defaults to `{}`. |
| `filterAxisQuantityKinds` | object | `{ [slot]: string\|null }`. Defaults to `{}`. |
| `vert` | string | GLSL vertex shader |
| `frag` | string | GLSL fragment shader |
| `schema` | function | `() => JSONSchema` |
| `createLayer` | function | `(parameters, data) => layerConfig` — see [createLayer Return Value](#createlayer-return-value) |
| `getAxisQuantityUnits` | function | `(parameters, data) => {x, y}` — required when any quantity kind is `null` |
| `getColorAxisQuantityKinds` | function | `(parameters, data) => { [slot]: string }` — required when any kind is `null` |
| `getFilterAxisQuantityKinds` | function | `(parameters, data) => { [slot]: string }` — required when any kind is `null` |

**Automatically provided shader uniforms:**

| Uniform | GLSL type | Description |
|---------|-----------|-------------|
| `xDomain` | `vec2` | [min, max] of the x spatial axis current range |
| `yDomain` | `vec2` | [min, max] of the y spatial axis current range |
| `count` | `int` | Number of data points |
| `colorscale_<slot>` | `int` | Colorscale index (one per color slot) |
| `color_range_<slot>` | `vec2` | [min, max] color range (one per color slot) |
| `filter_range_<slot>` | `vec4` | `[min, max, hasMin, hasMax]` (one per filter slot) |

**Automatically injected GLSL functions:**

```glsl
// Injected when color axes are present:
vec4 map_color(int cs, vec2 range, float value)

// Injected when filter axes are present:
bool filter_in_range(vec4 range, float value)
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl, layer)` | Compiles shaders and returns a regl draw function |
| `schema()` | Returns JSON Schema for layer parameters |
| `createLayer(parameters, data)` | Calls user factory, resolves axis quantity kinds, returns a ready-to-render layer |
| `resolveAxisQuantityUnits(parameters, data)` | Returns fully resolved `{x, y}` (merges static + dynamic) |
| `resolveColorAxisQuantityKinds(parameters, data, factoryColorAxes)` | Returns fully resolved color axes map |
| `resolveFilterAxisQuantityKinds(parameters, data, factoryFilterAxes)` | Returns fully resolved filter axes map |

---

### `createLayer` Return Value

The object returned by your `createLayer` function has this shape:

```javascript
{
  // GPU attribute arrays — property names must match GLSL attribute names
  attributes: {
    x: Float32Array,   // all arrays must be same length
    y: Float32Array,
    // ...
  },

  // Layer-specific GPU uniforms (in addition to the auto-provided ones)
  uniforms: {},

  // Which spatial axes to use
  xAxis: "xaxis_bottom",   // default
  yAxis: "yaxis_left",     // default

  // Color axes (optional) — one entry per declared slot
  colorAxes: {
    v: {
      quantityKind: "temperature",  // links to a shared color axis in config.axes
      data: Float32Array,           // per-point values for auto-range calculation
      colorscale: "viridis"         // default; overridable in config.axes
    }
  },

  // Filter axes (optional) — one entry per declared slot
  filterAxes: {
    z: {
      quantityKind: "depth",   // links to a shared filter axis in config.axes
      data: Float32Array       // per-point values tested against the filter range
    }
  }
}
```

All `Float32Array` values are validated at layer construction time — a `TypeError` is thrown if a regular array is passed.

---

### `scatterLayerType`

The built-in scatter plot layer type.

- **Spatial quantity kinds:** dynamic — each resolved from the corresponding `xData`/`yData` property name
- **Color slot:** `v`, quantity kind resolved from `vData`; default colorscale `"viridis"`
- **Point size:** 4.0 pixels

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `xData` | yes | Data key for x coordinates; also used as x-axis quantity kind |
| `yData` | yes | Data key for y coordinates; also used as y-axis quantity kind |
| `vData` | yes | Data key for color values; also used as color axis quantity kind |
| `xAxis` | no | x-axis position (default: `"xaxis_bottom"`) |
| `yAxis` | no | y-axis position (default: `"yaxis_left"`) |

---

### `registerColorscale(name, glslFn)`

Registers a custom colorscale.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique colorscale name |
| `glslFn` | string | GLSL function: `vec4 colorscale_<name>(float t) { ... }` where `t ∈ [0, 1]` |

```javascript
import { registerColorscale } from './src/index.js'

registerColorscale("my_scale", `
  vec4 colorscale_my_scale(float t) {
    return vec4(t, 1.0 - t, 0.5, 1.0);
  }
`)
```

---

### `getRegisteredColorscales()`

Returns `Map<string, string>` of all registered colorscale names to GLSL function strings.

---

### `buildColorGlsl()`

Returns the complete GLSL color dispatch string (all colorscale functions + `map_color` dispatcher). Injected automatically by `createDrawCommand`; only needed for custom WebGL integrations.

---

### `buildFilterGlsl()`

Returns the GLSL `filter_in_range` helper string. Injected automatically by `createDrawCommand`; only needed for custom WebGL integrations.

---

## Constants Reference

### `AXES`

```javascript
["xaxis_bottom", "xaxis_top", "yaxis_left", "yaxis_right"]
```

### Colorscales

All [matplotlib colorscales](https://matplotlib.org/stable/gallery/color/colormap_reference.html) are registered by default on import.

**Perceptually uniform sequential:**
`viridis`, `plasma`, `inferno`, `magma`, `cividis`

**Sequential (single-hue):**
`Blues`, `Greens`, `Reds`, `Oranges`, `Purples`, `Greys`

**Sequential (multi-hue):**
`YlOrBr`, `YlOrRd`, `OrRd`, `PuRd`, `RdPu`, `BuPu`, `GnBu`, `PuBu`, `YlGnBu`, `PuBuGn`, `BuGn`, `YlGn`

**Diverging:**
`PiYG`, `PRGn`, `BrBG`, `PuOr`, `RdGy`, `RdBu`, `RdYlBu`, `RdYlGn`, `Spectral`, `coolwarm`, `bwr`, `seismic`

**Cyclic:**
`twilight`, `twilight_shifted`, `hsv`

**Sequential (misc):**
`hot`, `afmhot`, `gist_heat`, `copper`, `bone`, `pink`, `spring`, `summer`, `autumn`, `winter`, `cool`, `Wistia`, `gray`

**Miscellaneous:**
`jet`, `turbo`, `rainbow`, `gnuplot`, `gnuplot2`, `CMRmap`, `cubehelix`, `nipy_spectral`, `gist_rainbow`, `gist_earth`, `terrain`, `ocean`, `brg`

Use `registerColorscale(name, glslFn)` to add custom colorscales.
