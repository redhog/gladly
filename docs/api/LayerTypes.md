# Writing Layer Types

This page covers how to define and register custom `LayerType` instances. For using layer types in a plot see [Configuring Plots](PlotConfiguration.md). For an overview of the data model see the [main API doc](../API.md).

---

## Overview

A `LayerType` encapsulates everything needed to render one kind of data visualization:

- GLSL vertex and fragment shaders
- Optional static axis declarations (for schema introspection and layer compatibility checks)
- A dynamic `getAxisConfig` resolver (for axis config that depends on parameters)
- A JSON Schema describing configuration parameters
- A `createLayer` factory that maps parameters + data → GPU attributes and uniforms

The axis information (quantity kinds, axis positions) is separated from the GPU data:

- **`getAxisConfig(parameters, data)`** — returns which axes to bind and their quantity kinds
- **`createLayer(parameters, data)`** — returns only GPU data: `{ attributes, uniforms, vertexCount? }`

Either or both can be omitted when static declarations cover the needed information.

---

## Minimal Example (no color or filter axes)

```javascript
import { LayerType, registerLayerType, AXES } from './src/index.js'

const redDotsType = new LayerType({
  name: "red_dots",
  xAxisQuantityKind: "meters",
  yAxisQuantityKind: "volts",

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      yAxis: parameters.yAxis,
    }
  },

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

  schema: (data) => ({
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
    const { xData, yData } = parameters
    return {
      attributes: { x: data[xData], y: data[yData] },
      uniforms: {},
    }
  }
})

registerLayerType("red_dots", redDotsType)
```

---

## With Color Axes

Color axes map a per-point numeric value to a color via a colorscale.

The color data attribute must be named after its quantity kind. For dynamic types (where the quantity kind comes from a parameter), use `%%color0%%` as a placeholder in the shader — it is substituted with `colorAxisQuantityKinds[0]` at layer creation time.

Colorscale is **not** specified in `createLayer`; it comes from:
1. `config.axes[quantityKind].colorscale` (per-plot override), or
2. The quantity kind registry definition (global default)

```javascript
import { LayerType, registerLayerType, AXES } from './src/index.js'

const heatDotsType = new LayerType({
  name: "heat_dots",
  xAxisQuantityKind: "meters",
  yAxisQuantityKind: "volts",
  // colorAxisQuantityKinds omitted — resolved dynamically from parameters

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      yAxis: parameters.yAxis,
      colorAxisQuantityKinds: [parameters.vData],
    }
  },

  vert: `
    precision mediump float;
    attribute float x, y;
    attribute float %%color0%%;
    uniform vec2 xDomain, yDomain;
    varying float value;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
      value = %%color0%%;
    }
  `,

  // map_color() is injected automatically when color axes are present
  frag: `
    precision mediump float;
    uniform int colorscale_%%color0%%;
    uniform vec2 color_range_%%color0%%;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale_%%color0%%, color_range_%%color0%%, value);
    }
  `,

  schema: (data) => ({
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

  createLayer: function(parameters, data) {
    const { xData, yData, vData } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], [vData]: data[vData] },
      uniforms: {},
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

Filter axes discard points whose attribute value falls outside a configured range.

The filter data attribute must be named after its quantity kind. Use `%%filter0%%` as a placeholder in the shader for dynamic quantity kinds.

```javascript
const filteredDotsType = new LayerType({
  name: "filtered_dots",
  xAxisQuantityKind: "meters",
  yAxisQuantityKind: "meters",

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      yAxis: parameters.yAxis,
      filterAxisQuantityKinds: [parameters.zData],
    }
  },

  vert: `
    precision mediump float;
    attribute float x, y;
    attribute float %%filter0%%;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_%%filter0%%;

    void main() {
      // filter_in_range() is injected automatically when filter axes are present
      if (!filter_in_range(filter_range_%%filter0%%, %%filter0%%)) {
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

  schema: (data) => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, zData } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], [zData]: data[zData] },
      uniforms: {},
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

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      xAxisQuantityKind: parameters.xData,
      yAxis: parameters.yAxis,
      yAxisQuantityKind: parameters.yData,
      colorAxisQuantityKinds:  [parameters.vData],
      filterAxisQuantityKinds: [parameters.zData],
    }
  },

  vert: `
    precision mediump float;
    attribute float x, y;
    attribute float %%color0%%;
    attribute float %%filter0%%;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_%%filter0%%;
    varying float value;

    void main() {
      if (!filter_in_range(filter_range_%%filter0%%, %%filter0%%)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 4.0;
      value = %%color0%%;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale_%%color0%%;
    uniform vec2 color_range_%%color0%%;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale_%%color0%%, color_range_%%color0%%, value);
    }
  `,

  schema: (data) => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, zData } = parameters
    return {
      attributes: {
        x: data[xData], y: data[yData],
        [vData]: data[vData],
        [zData]: data[zData],
      },
      uniforms: {},
    }
  }
})
```

---

## Static Axis Declarations

For layer types whose quantity kinds and axis positions are always the same regardless of parameters, declare them statically on the `LayerType`. This enables schema-based filtering of compatible layer types without calling any functions.

```javascript
const fixedScatterType = new LayerType({
  name: "fixed_scatter",
  // Static declarations — readable without parameters or data
  xAxis: "xaxis_bottom",
  xAxisQuantityKind: "distance_m",
  yAxis: "yaxis_left",
  yAxisQuantityKind: "current_A",
  colorAxisQuantityKinds: ["temperature_K"],
  filterAxisQuantityKinds: ["velocity_ms"],

  getAxisConfig: function(parameters) {
    // Only needed to pass through user-selectable axis positions
    return { xAxis: parameters.xAxis, yAxis: parameters.yAxis }
  },

  vert: `
    precision mediump float;
    attribute float x, y, temperature_K, velocity_ms;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_velocity_ms;
    varying float value;
    void main() {
      if (!filter_in_range(filter_range_velocity_ms, velocity_ms)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 5.0;
      value = temperature_K;
    }
  `,
  frag: `
    precision mediump float;
    uniform int colorscale_temperature_K;
    uniform vec2 color_range_temperature_K;
    varying float value;
    void main() {
      gl_FragColor = map_color(colorscale_temperature_K, color_range_temperature_K, value);
    }
  `,
  schema: () => ({ /* ... */ }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, fData } = parameters
    return {
      attributes: {
        x: data[xData], y: data[yData],
        temperature_K: data[vData],
        velocity_ms: data[fData],
      },
      uniforms: {},
    }
  }
})
```

Static declarations and `getAxisConfig` can be mixed freely. Dynamic values (non-`undefined`) override statics. Either is sufficient when it covers all needed axis information.

---

## Color Axes — Concepts

| Term | Description |
|------|-------------|
| **Quantity kind** | String identifier for the color axis (e.g. `"temperature_K"`). Layers sharing a quantity kind share a common range. Also names the GLSL attribute and the uniform suffixes. |
| **Colorscale** | Named GLSL color function (e.g. `"viridis"`). Set via `config.axes[quantityKind].colorscale` or the quantity kind registry. |

### Attribute and Uniform Naming

The color axis quantity kind is used as:
- The GPU attribute name: `attribute float temperature_K;`
- The uniform suffixes: `colorscale_temperature_K`, `color_range_temperature_K`

For dynamic layer types where the quantity kind is a parameter, use `%%color0%%` (for the first color axis), `%%color1%%` (for the second), etc. as placeholders — they are substituted with the actual quantity kind string at layer creation time.

### How the Plot Handles Color Axes

1. Registers each quantity kind with the `ColorAxisRegistry`
2. Scans all layer attributes named by that quantity kind and computes the auto range [min, max]
   (if no attribute by that name exists on a layer, that layer is skipped for auto-range)
3. Applies any override from `config.axes`
4. Passes `colorscale_<quantityKind>` (int) and `color_range_<quantityKind>` (vec2) as uniforms

### GLSL Integration

When a layer has color axes, `createDrawCommand` automatically:
1. Substitutes `%%colorN%%` placeholders with the actual quantity kind strings
2. Injects all registered colorscale GLSL functions
3. Injects `map_color(int cs, vec2 range, float value)` dispatch function

```glsl
uniform int colorscale_temperature_K;
uniform vec2 color_range_temperature_K;
varying float value;

void main() {
  gl_FragColor = map_color(colorscale_temperature_K, color_range_temperature_K, value);
}
```

---

## Filter Axes — Concepts

| Term | Description |
|------|-------------|
| **Quantity kind** | String identifier (e.g. `"velocity_ms"`). Layers sharing a quantity kind share the same filter range. Also names the GLSL attribute and uniform suffix. |
| **Open bound** | Missing `min` or `max` in `config.axes` means that bound is not enforced. |

### Attribute and Uniform Naming

The filter axis quantity kind names:
- The GPU attribute: `attribute float velocity_ms;`
- The uniform: `filter_range_velocity_ms` (vec4)

Use `%%filter0%%`, `%%filter1%%`, etc. as placeholders for dynamic quantity kinds.

### How the Plot Handles Filter Axes

1. Registers each quantity kind with the `FilterAxisRegistry`
2. Scans all layer attributes named by that quantity kind and computes the data extent
3. Applies `min`/`max` from `config.axes` if present; defaults to fully open bounds
4. Passes `filter_range_<quantityKind>` (vec4: `[min, max, hasMin, hasMax]`) as a uniform

### GLSL Integration

When a layer has filter axes, `createDrawCommand` automatically:
1. Substitutes `%%filterN%%` placeholders
2. Injects `filter_in_range(vec4, float)`

```glsl
uniform vec4 filter_range_velocity_ms;
attribute float velocity_ms;

void main() {
  if (!filter_in_range(filter_range_velocity_ms, velocity_ms)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);  // vertex shader discard
    return;
  }
  // ...
}
```

---

## API Reference

### `LayerType` Constructor

```javascript
new LayerType({ name,
                xAxis, xAxisQuantityKind,
                yAxis, yAxisQuantityKind,
                colorAxisQuantityKinds,
                filterAxisQuantityKinds,
                getAxisConfig,
                vert, frag, schema, createLayer })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Type identifier (e.g. `"scatter"`) |
| `xAxis` | string | Static default x-axis position (e.g. `"xaxis_bottom"`). Optional. |
| `xAxisQuantityKind` | string | Static x-axis quantity kind. Optional. |
| `yAxis` | string | Static default y-axis position (e.g. `"yaxis_left"`). Optional. |
| `yAxisQuantityKind` | string | Static y-axis quantity kind. Optional. |
| `colorAxisQuantityKinds` | string[] | Static quantity kinds for color axes. Optional, defaults to `[]`. |
| `filterAxisQuantityKinds` | string[] | Static quantity kinds for filter axes. Optional, defaults to `[]`. |
| `getAxisConfig` | function | `(parameters, data) => axisConfig` — dynamic axis config; overrides static fields wherever it returns a non-`undefined` value. Optional if statics cover all needed info. |
| `vert` | string | GLSL vertex shader |
| `frag` | string | GLSL fragment shader |
| `schema` | function | `(data) => JSONSchema` |
| `createLayer` | function | `(parameters, data) => { attributes, uniforms, vertexCount? }` — GPU data only |

**`getAxisConfig` return shape:**

```javascript
{
  xAxis?: string | null,             // null suppresses the x axis
  xAxisQuantityKind?: string,
  yAxis?: string | null,             // null suppresses the y axis
  yAxisQuantityKind?: string,
  colorAxisQuantityKinds?: string[],
  filterAxisQuantityKinds?: string[],
}
```

Any field that is `undefined` (or absent) leaves the corresponding static declaration in effect. `null` for `xAxis`/`yAxis` explicitly suppresses that axis.

**Automatically provided shader uniforms:**

| Uniform | GLSL type | Description |
|---------|-----------|-------------|
| `xDomain` | `vec2` | [min, max] of the x spatial axis current range |
| `yDomain` | `vec2` | [min, max] of the y spatial axis current range |
| `count` | `int` | Number of data points |
| `colorscale_<quantityKind>` | `int` | Colorscale index (one per color axis) |
| `color_range_<quantityKind>` | `vec2` | [min, max] color range (one per color axis) |
| `filter_range_<quantityKind>` | `vec4` | `[min, max, hasMin, hasMax]` (one per filter axis) |

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
| `createDrawCommand(regl, layer)` | Compiles shaders (with placeholder substitution) and returns a regl draw function |
| `schema(data)` | Returns JSON Schema for layer parameters |
| `createLayer(parameters, data)` | Calls user factory + `resolveAxisConfig`, returns a ready-to-render Layer |
| `resolveAxisConfig(parameters, data)` | Merges static declarations with `getAxisConfig` output (dynamic wins on non-`undefined`) |

---

### `createLayer` Return Value

The object returned by your `createLayer` function:

```javascript
{
  // GPU attribute arrays — property names must match GLSL attribute names.
  // Color and filter axis attributes must be named after their quantity kind.
  attributes: {
    x: Float32Array,
    y: Float32Array,
    temperature_K: Float32Array,   // color axis data, named by quantity kind
    velocity_ms:   Float32Array,   // filter axis data, named by quantity kind
    // ...
  },

  // Layer-specific GPU uniforms (in addition to the auto-provided ones)
  uniforms: {},

  // Optional: override vertex count (defaults to attributes.x.length)
  vertexCount: null,
}
```

All `Float32Array` values are validated at layer construction time.

---

### `scatterLayerType`

The built-in scatter plot layer type.

- **Spatial quantity kinds:** dynamic — each resolved from the corresponding `xData`/`yData` property name
- **Color axis:** quantity kind resolved from `vData`; colorscale from the quantity kind registry (default `"viridis"` if registered)
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
