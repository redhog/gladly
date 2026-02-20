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
- **`createLayer(parameters, data)`** — returns only GPU data: `{ attributes, uniforms, vertexCount?, nameMap? }`

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
    return [{
      attributes: { x: data[xData], y: data[yData] },
      uniforms: {},
    }]
  }
})

registerLayerType("red_dots", redDotsType)
```

---

## With Color Axes

Color axes map a per-point numeric value to a color via a colorscale.

The color data attribute must be keyed by the quantity kind in `attributes`. The shader can use any name — map the auto-generated uniform names to shader names via `nameMap` returned from `createLayer`.

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
    attribute float color_data;
    uniform vec2 xDomain, yDomain;
    varying float value;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
      value = color_data;
    }
  `,

  // map_color() is injected automatically when color axes are present
  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale, color_range, value);
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
    return [{
      attributes: { x: data[xData], y: data[yData], [vData]: data[vData] },
      uniforms: {},
      nameMap: {
        [vData]: 'color_data',
        [`colorscale_${vData}`]: 'colorscale',
        [`color_range_${vData}`]: 'color_range',
      },
    }]
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

The filter data attribute must be keyed by the quantity kind in `attributes`. Use `nameMap` to give it a friendlier shader name.

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
    attribute float filter_data;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range;

    void main() {
      // filter_in_range() is injected automatically when filter axes are present
      if (!filter_in_range(filter_range, filter_data)) {
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
    return [{
      attributes: { x: data[xData], y: data[yData], [zData]: data[zData] },
      uniforms: {},
      nameMap: {
        [zData]: 'filter_data',
        [`filter_range_${zData}`]: 'filter_range',
      },
    }]
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
    attribute float color_data;
    attribute float filter_data;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range;
    varying float value;

    void main() {
      if (!filter_in_range(filter_range, filter_data)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 4.0;
      value = color_data;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    varying float value;

    void main() {
      gl_FragColor = map_color(colorscale, color_range, value);
    }
  `,

  schema: (data) => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, zData } = parameters
    return [{
      attributes: {
        x: data[xData], y: data[yData],
        [vData]: data[vData],
        [zData]: data[zData],
      },
      uniforms: {},
      nameMap: {
        [vData]: 'color_data',
        [`colorscale_${vData}`]: 'colorscale',
        [`color_range_${vData}`]: 'color_range',
        [zData]: 'filter_data',
        [`filter_range_${zData}`]: 'filter_range',
      },
    }]
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
    return [{
      attributes: {
        x: data[xData], y: data[yData],
        temperature_K: data[vData],
        velocity_ms: data[fData],
      },
      uniforms: {},
    }]
  }
})
```

Static declarations and `getAxisConfig` can be mixed freely. Dynamic values (non-`undefined`) override statics. Either is sufficient when it covers all needed axis information.

---

## Optional: Using `Data.wrap` for Multiple Data Formats

> **This is entirely optional.** Nothing in the plotting framework requires it. If your layer type always receives a flat `{ column: Float32Array }` object, just read it directly. `Data.wrap` is a convenience for layer types that want to support richer data shapes.

The built-in `scatter` layer calls `Data.wrap(data)` in both `createLayer` and `getAxisConfig` so that it accepts plain flat objects, per-column rich objects, and the columnar format (see [`Data`](Reference.md#data) for format details). Custom layer types can do the same.

**Pattern:** replace `data[col]` with `d.getData(col)`, and derive quantity kinds from the data rather than hardcoding them:

```javascript
import { LayerType, registerLayerType, Data, AXES } from './src/index.js'

const myLayerType = new LayerType({
  name: "my_layer",

  getAxisConfig: function(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, xAxis, yAxis } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
      colorAxisQuantityKinds: [d.getQuantityKind(vData) ?? vData],
    }
  },

  // ... vert, frag, schema ...

  createLayer: function(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData } = parameters

    // Resolve the quantity kind: use data-provided kind if present, else column name
    const vQK = d.getQuantityKind(vData) ?? vData

    const x = d.getData(xData)
    const y = d.getData(yData)
    const v = d.getData(vData)

    // Pass any pre-computed domain from the data, keyed by quantity kind
    const domains = {}
    const vDomain = d.getDomain(vData)
    if (vDomain) domains[vQK] = vDomain

    return [{
      attributes: { x, y, [vQK]: v },
      uniforms: {},
      domains,
      nameMap: {
        [vQK]:                      'color_data',
        [`colorscale_${vQK}`]:      'colorscale',
        [`color_range_${vQK}`]:     'color_range',
        [`color_scale_type_${vQK}`]:'color_scale_type',
      },
    }]
  }
})
```

**What this enables:**

- **Simple flat objects** (`{ x: Float32Array, ... }`) continue to work exactly as before.
- **Per-column metadata** (`{ x: { data: Float32Array, quantity_kind: "distance_m" } }`) allows the data to carry its own axis identities.
- **Columnar format** (`{ data: {...}, quantity_kinds: {...}, domains: {...} }`) keeps arrays and metadata in separate sub-objects.
- **Custom `Data`-compatible classes** — `Data.wrap` is a no-op for any object that already has `columns` and `getData` methods, so your own domain objects work too.

When quantity kinds come from the data, the axis key in `config.axes` should use the quantity kind string rather than the column name. For example, if `vData: "myCol"` but `getQuantityKind("myCol")` returns `"temperature_K"`, the color axis is registered as `temperature_K`, so the plot config uses `axes: { temperature_K: { colorscale: "plasma" } }`.

---

## Color Axes — Concepts

| Term | Description |
|------|-------------|
| **Quantity kind** | String identifier for the color axis (e.g. `"temperature_K"`). Layers sharing a quantity kind share a common range. Also names the GLSL attribute and the uniform suffixes. |
| **Colorscale** | Named GLSL color function (e.g. `"viridis"`). Set via `config.axes[quantityKind].colorscale` or the quantity kind registry. |

### Attribute and Uniform Naming

The system generates uniforms keyed by the quantity kind:
- GPU attribute key in `attributes`: `temperature_K`
- Uniforms: `colorscale_temperature_K`, `color_range_temperature_K`

For static layer types the quantity kind is fixed, so these names can be used directly in the shader. For dynamic types (where the quantity kind comes from a parameter), return a `nameMap` from `createLayer` to map these internal names to your chosen shader names.

### How the Plot Handles Color Axes

1. Registers each quantity kind with the `ColorAxisRegistry`
2. Scans all layer attributes keyed by that quantity kind and computes the auto range [min, max]
   (if no attribute by that name exists on a layer, that layer is skipped for auto-range)
3. Applies any override from `config.axes`
4. Passes `colorscale_<quantityKind>` (int) and `color_range_<quantityKind>` (vec2) as uniforms

### GLSL Integration

When a layer has color axes, `createDrawCommand` automatically:
1. Applies the layer's `nameMap` to rename uniform/attribute keys to shader-visible names
2. Injects all registered colorscale GLSL functions
3. Injects `map_color(int cs, vec2 range, float value)` dispatch function

```glsl
// Static layer type — shader names match generated names directly:
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

The system generates names keyed by the quantity kind:
- GPU attribute key in `attributes`: `velocity_ms`
- Uniform: `filter_range_velocity_ms` (vec4)

For static layer types these can be used in the shader directly. For dynamic types, return a `nameMap` from `createLayer` to map them to friendly shader names.

### How the Plot Handles Filter Axes

1. Registers each quantity kind with the `FilterAxisRegistry`
2. Scans all layer attributes keyed by that quantity kind and computes the data extent
3. Applies `min`/`max` from `config.axes` if present; defaults to fully open bounds
4. Passes `filter_range_<quantityKind>` (vec4: `[min, max, hasMin, hasMax]`) as a uniform

### GLSL Integration

When a layer has filter axes, `createDrawCommand` automatically:
1. Applies the layer's `nameMap` to rename uniform/attribute keys to shader-visible names
2. Injects `filter_in_range(vec4, float)`

```glsl
// Static layer type — shader names match generated names directly:
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

## Instanced Rendering

Use instanced rendering when a single data point needs to emit multiple vertices (e.g. a rectangle is 6 vertices) without a CPU loop to expand the geometry.

The pattern uses two types of attributes:
- **Per-vertex** (`divisor 0`, default): advance once per vertex. Store shared vertex-local geometry (e.g. quad corner coordinates).
- **Per-instance** (`divisor 1`): advance once per instance (data point). Store per-rect data (x, top, bottom, neighbors).

The GPU executes `vertexCount` vertices × `instanceCount` instances. Each vertex shader invocation sees the current per-vertex attribute *and* the current per-instance attributes for its instance.

**Neighbor arrays** can be built without explicit JS loops using `TypedArray.set()`:

```javascript
const xPrev = new Float32Array(n)
xPrev.set(x.subarray(0, n - 1), 1)   // xPrev[1..n-1] = x[0..n-2]
xPrev[0] = n > 1 ? 2 * x[0] - x[1] : x[0]  // mirror boundary

const xNext = new Float32Array(n)
xNext.set(x.subarray(1), 0)           // xNext[0..n-2] = x[1..n-1]
xNext[n - 1] = n > 1 ? 2 * x[n - 1] - x[n - 2] : x[n - 1]
```

### Example: rectangle layer

```javascript
// Per-vertex quad corner coordinates (two CCW triangles: BL-BR-TR, BL-TR-TL)
const QUAD_CX = new Float32Array([0, 1, 1, 0, 1, 0])
const QUAD_CY = new Float32Array([0, 0, 1, 0, 1, 1])

const rectLayerType = new LayerType({
  name: "rects",
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left",

  getAxisConfig: (params) => ({
    xAxis: params.xAxis,
    xAxisQuantityKind: params.xData,
    yAxis: params.yAxis,
    yAxisQuantityKind: params.yTopData,
  }),

  vert: `
    precision mediump float;
    attribute float cx;    // per-vertex: quad corner x (0 or 1)
    attribute float cy;    // per-vertex: quad corner y (0 or 1)
    attribute float x;     // per-instance: rect center
    attribute float xPrev; // per-instance: previous center (mirror at boundary)
    attribute float xNext; // per-instance: next center (mirror at boundary)
    attribute float top;   // per-instance: top y
    attribute float bot;   // per-instance: bottom y
    uniform float uE;
    uniform vec2 xDomain, yDomain;
    uniform float xScaleType, yScaleType;

    void main() {
      float halfLeft  = (x - xPrev) / 2.0;
      float halfRight = (xNext - x) / 2.0;
      // Cap: if one side exceeds e, use the other side (simultaneous, using originals).
      float hl = halfLeft  > uE ? halfRight : halfLeft;
      float hr = halfRight > uE ? halfLeft  : halfRight;

      float xPos = cx > 0.5 ? x + hr : x - hl;
      float yPos = cy > 0.5 ? top : bot;

      float nx = normalize_axis(xPos, xDomain, xScaleType);
      float ny = normalize_axis(yPos, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
    }
  `,

  frag: `
    precision mediump float;
    void main() { gl_FragColor = vec4(0.2, 0.5, 0.8, 1.0); }
  `,

  schema: (data) => ({ /* ... */ }),

  createLayer: function(params, data) {
    const { xData, yTopData, yBottomData, e = Infinity } = params
    const x = data[xData], top = data[yTopData], bot = data[yBottomData]
    const n = x.length

    const xPrev = new Float32Array(n)
    xPrev.set(x.subarray(0, n - 1), 1)
    xPrev[0] = n > 1 ? 2 * x[0] - x[1] : x[0]

    const xNext = new Float32Array(n)
    xNext.set(x.subarray(1), 0)
    xNext[n - 1] = n > 1 ? 2 * x[n - 1] - x[n - 2] : x[n - 1]

    const xMin   = x.reduce((a, v) => Math.min(a, v), Infinity)
    const xMax   = x.reduce((a, v) => Math.max(a, v), -Infinity)
    const topMin = top.reduce((a, v) => Math.min(a, v), Infinity)
    const topMax = top.reduce((a, v) => Math.max(a, v), -Infinity)
    const botMin = bot.reduce((a, v) => Math.min(a, v), Infinity)
    const botMax = bot.reduce((a, v) => Math.max(a, v), -Infinity)

    return [{
      attributes: {
        cx: QUAD_CX, cy: QUAD_CY,   // per-vertex
        x, xPrev, xNext, top, bot,  // per-instance
      },
      attributeDivisors: { x: 1, xPrev: 1, xNext: 1, top: 1, bot: 1 },
      uniforms: { uE: e },
      domains: {
        [xData]:    [xMin, xMax],
        [yTopData]: [Math.min(topMin, botMin), Math.max(topMax, botMax)],
      },
      primitive: "triangles",
      vertexCount: 6,
      instanceCount: n,
    }]
  },
})
```

**Key points:**
- `attributeDivisors` — maps attribute names to their divisor (1 = per-instance; 0 or absent = per-vertex)
- `vertexCount: 6` — vertices per instance (the quad)
- `instanceCount: n` — number of instances (data points)
- `domains` — pre-computed ranges covering multiple source arrays (both `top` and `bottom` for the y axis), so auto-range doesn't need an attribute to scan

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
| `createLayer` | function | `(parameters, data) => Array<{ attributes, uniforms, primitive?, vertexCount?, instanceCount?, attributeDivisors?, nameMap?, blend? }>` — GPU data only; each element becomes one `Layer` |

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

| Uniform | GLSL type | When | Description |
|---------|-----------|------|-------------|
| `xDomain` | `vec2` | always | `[min, max]` of the x spatial axis current range |
| `yDomain` | `vec2` | always | `[min, max]` of the y spatial axis current range |
| `xScaleType` | `float` | always | `0.0` = linear, `1.0` = log |
| `yScaleType` | `float` | always | `0.0` = linear, `1.0` = log |
| `count` | `int` | always | Number of data points (vertices) |
| `colorscale_<quantityKind>` | `int` | color axes | Colorscale index (one per color axis) |
| `color_range_<quantityKind>` | `vec2` | color axes | `[min, max]` color range (one per color axis) |
| `color_scale_type_<quantityKind>` | `float` | color axes | `0.0` = linear, `1.0` = log (one per color axis) |
| `filter_range_<quantityKind>` | `vec4` | filter axes | `[min, max, hasMin, hasMax]` (one per filter axis) |
| `filter_scale_type_<quantityKind>` | `float` | filter axes | `0.0` = linear, `1.0` = log (one per filter axis) |

**Automatically injected GLSL functions:**

```glsl
// Always injected into vertex shader:
float normalize_axis(float v, vec2 domain, float scaleType)
// Maps v from data-space to [0, 1], handling both linear and log scales.
// scaleType: 0.0 = linear, 1.0 = log.

// Injected when color axes are present (both vertex and fragment shader):
vec4 map_color(int cs, vec2 range, float value)
// Maps value to RGBA using colorscale cs and linear range.

vec4 map_color_s(int cs, vec2 range, float value, float scaleType)
// Like map_color but handles log scale: applies log() to value and range
// before mapping when scaleType > 0.5.

// Injected when filter axes are present (vertex shader):
bool filter_in_range(vec4 range, float value)
// Returns false when value is outside the filter bounds.
// range: [min, max, hasMin, hasMax]; open bounds (hasMin/hasMax == 0) always pass.
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl, layer)` | Compiles shaders and returns a regl draw function; applies `nameMap` to rename uniform/attribute keys |
| `schema(data)` | Returns JSON Schema for layer parameters |
| `createLayer(parameters, data)` | Calls user factory + `resolveAxisConfig`, returns a ready-to-render Layer |
| `resolveAxisConfig(parameters, data)` | Merges static declarations with `getAxisConfig` output (dynamic wins on non-`undefined`) |

---

### `createLayer` Return Value

`createLayer` must return an **array** of GPU config objects. Each element becomes one rendered `Layer`. Returning multiple elements renders multiple draw calls from one layer spec (e.g. one per data series).

Each element in the array:

```javascript
{
  // GPU attribute arrays — keyed by internal name (quantity kind for color/filter axes).
  // Use nameMap to rename them in the shader.
  attributes: {
    x: Float32Array,
    y: Float32Array,
    temperature_K: Float32Array,   // color axis data, keyed by quantity kind
    velocity_ms:   Float32Array,   // filter axis data, keyed by quantity kind
    // ...
  },

  // Layer-specific GPU uniforms (in addition to the auto-provided ones).
  // Keys are shader-visible names (or use nameMap to rename them).
  uniforms: {},

  // Optional: pre-computed [min, max] domains keyed by quantity kind.
  // When present for a quantity kind, auto-range skips scanning layer.attributes
  // for that axis. Works for spatial axes (keyed by xAxisQuantityKind /
  // yAxisQuantityKind), color axes, and filter axes.
  // Useful when the layer's y-range spans multiple arrays (e.g. top + bottom),
  // or for instanced layers where per-instance arrays don't match axis quantity kinds.
  domains: {
    myXQuantityKind: [xMin, xMax],
    myYQuantityKind: [Math.min(topMin, botMin), Math.max(topMax, botMax)],
  },

  // Optional: WebGL primitive type. Defaults to "points".
  // Set per element to use different primitives in different draw calls.
  // Valid values: "points", "lines", "line strip", "line loop",
  //               "triangles", "triangle strip", "triangle fan"
  primitive: "points",

  // Optional: override vertex count (defaults to attributes.x.length).
  // Required for instanced rendering (set to vertices per instance, e.g. 6 for a quad).
  vertexCount: null,

  // Optional: number of instances for instanced rendering (ANGLE_instanced_arrays).
  // When set, the draw call renders vertexCount vertices × instanceCount instances.
  // Omit (or null) for non-instanced rendering.
  instanceCount: null,

  // Optional: per-attribute divisors for instanced rendering.
  // A divisor of 1 means the attribute advances once per instance (per-instance data).
  // A divisor of 0 (or absent) means it advances once per vertex (per-vertex data).
  attributeDivisors: {
    x: 1, xPrev: 1, xNext: 1, top: 1, bot: 1,  // per-instance
    // cx, cy omitted → divisor 0 (per-vertex)
  },

  // Optional: maps internal names → shader-visible names.
  // Applies to attribute keys, uniform keys, and all auto-generated uniform names
  // (colorscale_<qk>, color_range_<qk>, filter_range_<qk>, xDomain, etc.).
  // Entries absent from nameMap pass through unchanged.
  nameMap: {
    temperature_K:              'color_data',
    colorscale_temperature_K:   'colorscale',
    color_range_temperature_K:  'color_range',
    velocity_ms:                'filter_data',
    filter_range_velocity_ms:   'filter_range',
  },

  // Optional: regl blend configuration for this draw call.
  // When null or omitted, blending is disabled (the default for opaque layers).
  // When provided, passed directly to regl as the blend config.
  // Use separate srcAlpha/dstAlpha to avoid writing into the canvas alpha channel:
  blend: {
    enable: true,
    func: {
      srcRGB:   'src alpha',           // RGB: weight by fragment alpha
      dstRGB:   'one minus src alpha', // RGB: preserve background scaled by (1 - alpha)
      srcAlpha: 0,                     // alpha channel: ignore fragment alpha
      dstAlpha: 1,                     // alpha channel: preserve framebuffer alpha unchanged
    },
  },
}
```

All values in `attributes` must be `Float32Array` and are validated at layer construction time.

---

### Built-in layer types

The built-in `scatter`, `colorbar`, and `filterbar` layer types are documented in [Built-in Layer Types](BuiltInLayerTypes.md).

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
