# Writing Layer Types

This page covers how to define and register custom `LayerType` instances. For using layer types in a plot see [Configuring Plots](../configuration/PlotConfiguration.md). For an overview of the data model see the [main API doc](../user-api/overview.md).

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
- **`createLayer(parameters, data)`** — returns only GPU data: `{ attributes, uniforms, vertexCount?, ... }`

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

  vert: `#version 300 es
    precision highp float;
    in float x, y;
    uniform vec2 xDomain, yDomain;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
    }
  `,

  frag: `#version 300 es
    precision highp float;
    out vec4 fragColor;
    void main() {
      fragColor = gladly_apply_color(vec4(1.0, 0.0, 0.0, 1.0));
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
    const d = Data.wrap(data)  // data is already a DataGroup; wrap() is a no-op
    const { xData, yData } = parameters
    // Pass column name strings — the framework resolves them to ColumnData at draw time.
    // Alternatively pass d.getData(xData) directly for a ColumnData instance.
    return [{
      attributes: { x: xData, y: yData },
      uniforms: {},
    }]
  }
})

registerLayerType("red_dots", redDotsType)
```

---

## With Color Axes

Color axes map a per-point numeric value to a color via a colorscale.

Colorscale is **not** specified in `createLayer`; it comes from:
1. `config.axes[quantityKind].colorscale` (per-plot override), or
2. The quantity kind registry definition (global default)

`colorAxisQuantityKinds` is a dictionary mapping a **GLSL name suffix** to the quantity kind for each color axis. The suffix is appended to the base uniform names `colorscale`, `color_range`, `color_scale_type` to form the GLSL uniform names:
- Suffix `''` → uniforms named `colorscale`, `color_range`, `color_scale_type`
- Suffix `'2'` → uniforms named `colorscale2`, `color_range2`, `color_scale_type2`
- Suffix `'_a'` → uniforms named `colorscale_a`, `color_range_a`, `color_scale_type_a`

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
      // suffix '' → shader uniforms: colorscale, color_range, color_scale_type
      colorAxisQuantityKinds: { '': parameters.vData },
    }
  },

  vert: `#version 300 es
    precision highp float;
    in float x, y;
    in float color_data;
    uniform vec2 xDomain, yDomain;
    out float value;

    void main() {
      float nx = (x - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (y - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
      gl_PointSize = 6.0;
      value = color_data;
    }
  `,

  // map_color_s() is injected automatically when color axes are present
  // It calls gladly_apply_color() internally, so no explicit wrap needed.
  frag: `#version 300 es
    precision highp float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    in float value;
    out vec4 fragColor;

    void main() {
      fragColor = map_color_s(colorscale, color_range, value, color_scale_type, 0.0);
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
    // Column name strings — resolved to ColumnData by the framework at draw time.
    return [{
      attributes: { x: xData, y: yData, color_data: vData },
      uniforms: {},
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

`filterAxisQuantityKinds` is a dictionary mapping a **GLSL name suffix** to the quantity kind for each filter axis. The suffix is appended to the base uniform names `filter_range` and `filter_scale_type`:
- Suffix `''` → uniforms named `filter_range`, `filter_scale_type`
- Suffix `'2'` → uniforms named `filter_range2`, `filter_scale_type2`

```javascript
const filteredDotsType = new LayerType({
  name: "filtered_dots",
  xAxisQuantityKind: "meters",
  yAxisQuantityKind: "meters",

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      yAxis: parameters.yAxis,
      // suffix '' → shader uniforms: filter_range, filter_scale_type
      filterAxisQuantityKinds: { '': parameters.zData },
    }
  },

  vert: `#version 300 es
    precision highp float;
    in float x, y;
    in float filter_data;
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

  frag: `#version 300 es
    precision highp float;
    out vec4 fragColor;
    void main() { fragColor = gladly_apply_color(vec4(0.0, 0.5, 1.0, 1.0)); }
  `,

  schema: (data) => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, zData } = parameters
    return [{
      attributes: { x: xData, y: yData, filter_data: zData },
      uniforms: {},
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
      colorAxisQuantityKinds:  { '': parameters.vData },
      filterAxisQuantityKinds: { '': parameters.zData },
    }
  },

  vert: `#version 300 es
    precision highp float;
    in float x, y;
    in float color_data;
    in float filter_data;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range;
    out float value;

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

  frag: `#version 300 es
    precision highp float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    in float value;
    out vec4 fragColor;

    void main() {
      fragColor = map_color_s(colorscale, color_range, value, color_scale_type, 0.0);
    }
  `,

  schema: (data) => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, zData } = parameters
    return [{
      attributes: {
        x: xData, y: yData,
        color_data: vData,
        filter_data: zData,
      },
      uniforms: {},
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
  colorAxisQuantityKinds: { '': "temperature_K" },
  filterAxisQuantityKinds: { '': "velocity_ms" },

  getAxisConfig: function(parameters) {
    // Only needed to pass through user-selectable axis positions
    return { xAxis: parameters.xAxis, yAxis: parameters.yAxis }
  },

  vert: `#version 300 es
    precision highp float;
    in float x, y, temperature_K, velocity_ms;
    uniform vec2 xDomain, yDomain;
    uniform vec4 filter_range_velocity_ms;
    out float value;
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
  frag: `#version 300 es
    precision highp float;
    uniform int colorscale_temperature_K;
    uniform vec2 color_range_temperature_K;
    uniform float color_scale_type_temperature_K;
    in float value;
    out vec4 fragColor;
    void main() {
      fragColor = map_color_s(colorscale_temperature_K, color_range_temperature_K, value, color_scale_type_temperature_K, 0.0);
    }
  `,
  schema: () => ({ /* ... */ }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, fData } = parameters
    return [{
      attributes: {
        x: xData, y: yData,
        temperature_K: vData,
        velocity_ms: fData,
      },
      uniforms: {},
    }]
  }
})
```

Static declarations and `getAxisConfig` can be mixed freely. Dynamic values (non-`undefined`) override statics. Either is sufficient when it covers all needed axis information.

---

## Using `Data.wrap` for Metadata and Domain Access

The `data` argument received by `createLayer` and `getAxisConfig` is always a `DataGroup` produced by the framework's `normalizeData()` call. Calling `Data.wrap(data)` on it is a no-op (it already has the `columns`/`getData` interface) and is the conventional way to write layer type code that reads metadata.

The built-in `points` and `lines` layers call `Data.wrap(data)` in both `createLayer` and `getAxisConfig` to access quantity kinds and pre-computed domains from the data. Custom layer types should follow the same pattern.

**Pattern:** use column name strings or `d.getData(col)` for attributes, and derive quantity kinds from the data rather than hardcoding them. `d.getData(col)` returns a `ColumnData` instance — use `.array` for CPU access (only on `ArrayColumn`) or pass the column name string as an attribute value to let the framework resolve it at draw time:

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
      // suffix '' → shader uniforms: colorscale, color_range, color_scale_type
      colorAxisQuantityKinds: { '': d.getQuantityKind(vData) ?? vData },
    }
  },

  // ... vert, frag, schema ...

  createLayer: function(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData } = parameters

    // Resolve the quantity kind: use data-provided kind if present, else column name
    const vQK = d.getQuantityKind(vData) ?? vData

    // getData() returns ColumnData (ArrayColumn for plain data, TextureColumn for transforms).
    // For plain Float32Array access use col.array (ArrayColumn only).
    const xCol = d.getData(xData)
    const vDomain = xCol.domain  // domain is on ColumnData, not from d.getDomain separately

    // Pass any pre-computed domain from the data, keyed by quantity kind
    const colDomain = d.getData(vData)?.domain
    const domains = {}
    if (colDomain) domains[vQK] = colDomain

    // Attribute values can be column name strings, ColumnData, or Float32Array.
    // The framework resolves strings and ColumnData to GPU textures at draw time.
    return [{
      attributes: { x: xData, y: yData, color_data: vData },
      uniforms: {},
      domains,
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
| **Quantity kind** | String identifier for the color axis (e.g. `"temperature_K"`). Layers sharing a quantity kind share a common range. |
| **GLSL name suffix** | Key in the `colorAxisQuantityKinds` dict (e.g. `''`, `'2'`, `'_a'`). Appended to base uniform names to form the shader-visible names for that color axis. |
| **Colorscale** | Named GLSL color function (e.g. `"viridis"`). Set via `config.axes[quantityKind].colorscale` or the quantity kind registry. |

### Uniform Naming

`colorAxisQuantityKinds` is a `Record<suffix, quantityKind>`. For each entry, `createDrawCommand` exposes uniforms named `colorscale${suffix}`, `color_range${suffix}`, `color_scale_type${suffix}`.

Examples:
- `{ '': 'temperature_K' }` → uniforms `colorscale`, `color_range`, `color_scale_type`
- `{ '': 'temp_K', '2': 'pressure_Pa' }` → uniforms `colorscale`/`colorscale2`, `color_range`/`color_range2`, `color_scale_type`/`color_scale_type2`
- `{ '_a': 'xQK', '_b': 'yQK' }` → uniforms `colorscale_a`/`colorscale_b`, `color_range_a`/`color_range_b`, `color_scale_type_a`/`color_scale_type_b`

The render loop passes these via internal prop names `colorscale_<quantityKind>`, `color_range_<quantityKind>`, `color_scale_type_<quantityKind>` and `createDrawCommand` maps them to the GLSL names automatically. Layer authors use the GLSL names directly in shaders and attributes.

### How the Plot Handles Color Axes

1. Registers each quantity kind via `axisRegistry.ensureColorAxis(qk)` (color axes are managed inside `AxisRegistry`)
2. Scans `layer.domains` for that quantity kind and computes the auto range [min, max]
   (if no domain exists, falls back to scanning `layer.attributes` by quantity kind name)
3. Applies any override from `config.axes`
4. Passes uniforms to the draw call

### GLSL Integration

When a layer has color axes, `createDrawCommand` automatically:
1. Injects all registered colorscale GLSL functions
2. Injects `map_color(int cs, vec2 range, float value)` dispatch function

```glsl
// Using suffix '' — GLSL uniform names are: colorscale, color_range, color_scale_type
uniform int colorscale;
uniform vec2 color_range;
uniform float color_scale_type;
in float value;
out vec4 fragColor;

void main() {
  // map_color_s calls gladly_apply_color internally — no explicit wrap needed.
  fragColor = map_color_s(colorscale, color_range, value, color_scale_type, 0.0);
}
```

---

## Filter Axes — Concepts

| Term | Description |
|------|-------------|
| **Quantity kind** | String identifier (e.g. `"velocity_ms"`). Layers sharing a quantity kind share the same filter range. |
| **GLSL name suffix** | Key in the `filterAxisQuantityKinds` dict (e.g. `''`, `'2'`). Appended to `filter_range` and `filter_scale_type` to form the shader-visible uniform names. |
| **Open bound** | Missing `min` or `max` in `config.axes` means that bound is not enforced. |

### Uniform Naming

`filterAxisQuantityKinds` is a `Record<suffix, quantityKind>`. For each entry, `createDrawCommand` exposes uniforms `filter_range${suffix}` and `filter_scale_type${suffix}`.

Examples:
- `{ '': 'velocity_ms' }` → uniforms `filter_range`, `filter_scale_type`
- `{ '2': 'depth_m' }` → uniforms `filter_range2`, `filter_scale_type2`

### How the Plot Handles Filter Axes

1. Registers each quantity kind via `axisRegistry.ensureFilterAxis(qk)` (filter axes are managed inside `AxisRegistry`)
2. Scans `layer.domains` and `layer.attributes` (by quantity kind name) and computes the data extent
3. Applies `min`/`max` from `config.axes` if present; defaults to fully open bounds
4. Passes uniforms to the draw call

### GLSL Integration

When a layer has filter axes, `createDrawCommand` automatically:
1. Injects `filter_in_range(vec4, float)`

```glsl
// Using suffix '' — GLSL uniform name is: filter_range
uniform vec4 filter_range;
in float filter_data;

void main() {
  if (!filter_in_range(filter_range, filter_data)) {
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

  vert: `#version 300 es
    precision highp float;
    in float cx;    // per-vertex: quad corner x (0 or 1)
    in float cy;    // per-vertex: quad corner y (0 or 1)
    in float x;     // per-instance: rect center
    in float xPrev; // per-instance: previous center (mirror at boundary)
    in float xNext; // per-instance: next center (mirror at boundary)
    in float top;   // per-instance: top y
    in float bot;   // per-instance: bottom y
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

  frag: `#version 300 es
    precision highp float;
    out vec4 fragColor;
    void main() { fragColor = gladly_apply_color(vec4(0.2, 0.5, 0.8, 1.0)); }
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
    }],
  },
})
```

**Key points:**
- `attributeDivisors` — maps attribute names to their divisor (1 = per-instance; 0 or absent = per-vertex)
- `vertexCount: 6` — vertices per instance (the quad)
- `instanceCount: n` — number of instances (data points)
- `domains` — pre-computed ranges covering multiple source arrays (both `top` and `bottom` for the y axis), so auto-range doesn't need an attribute to scan

---

## Picking Support

GPU picking lets the application identify which layer and data point is under the mouse cursor. The framework handles the mechanics automatically — layer authors only need to follow one rule: **always assign `fragColor` through `gladly_apply_color()`**.

### The rule

All fragment shaders must write to a declared `out vec4 fragColor` (GLSL ES 3.0). Always route through `gladly_apply_color()`:

```glsl
// ✅ Correct — picking works automatically
out vec4 fragColor;
void main() {
  vec4 color = /* your color calculation */;
  fragColor = gladly_apply_color(color);
}

// ❌ Wrong — pick pass will not detect this fragment
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
```

In normal rendering, `gladly_apply_color` is a pass-through and has no effect on visual output. In a GPU pick pass it encodes the layer and vertex index into the RGBA channels.

### Using `map_color_s`

`map_color_s` calls `gladly_apply_color` internally, so layers using it for their final output need **no additional call**:

```glsl
out vec4 fragColor;
void main() {
  // gladly_apply_color is called inside map_color_s — no wrapping needed
  fragColor = map_color_s(colorscale, color_range, value, color_scale_type, 0.0);
}
```

Only wrap `gladly_apply_color` explicitly when doing additional processing after `map_color_s` (e.g. custom alpha):

```glsl
out vec4 fragColor;
void main() {
  float t = clamp((value - color_range.x) / (color_range.y - color_range.x), 0.0, 1.0);
  vec4 color = map_color_s(colorscale, color_range, value, color_scale_type, 0.0);
  fragColor = gladly_apply_color(vec4(color.rgb, t));  // explicit wrap needed here
}
```

Double-calling `gladly_apply_color` is safe: in pick mode it always returns the correct pick encoding regardless of input.

### Tiled layers

For tiled layers (texture tiles or `Float32Array[]` buffer attributes), `plot.pick()` returns `{ tile, index }` identifying which tile and which vertex within that tile was clicked — no manual decoding is needed.

The vertex shader receives `a_pickId` (local 0..N-1 within a tile, used for texture sampling) and a `u_tile_pick_offset` uniform (set per tile by the render loop). The pick colour is encoded from the global pick ID automatically:

```glsl
// injected automatically — no action needed in the layer shader
float global_pick_id = a_pickId + u_tile_pick_offset;
v_pickId = global_pick_id;
```

After each draw the render loop stores the per-tile offset table on `layer._tilePickOffsets`. `plot.pick()` uses this to decode `tile` and `index` before returning.

See [Tiled Data](../tiled-data.md) for the internal offset model.

### Instanced layers

For instanced layers (`instanceCount !== null`), `a_pickId` is a per-instance attribute (divisor 1). The `dataIndex` returned by `plot.pick()` is therefore the **instance** index into the per-instance attribute arrays. When reading back picked values, filter out per-vertex attributes:

```javascript
const { layer, dataIndex } = result
const isInstanced = layer.instanceCount !== null
const row = Object.fromEntries(
  Object.entries(layer.attributes)
    .filter(([k]) => !isInstanced || (layer.attributeDivisors[k] ?? 0) === 1)
    .map(([k, v]) => [k, v[dataIndex]])
)
```

### Layers that override `createDrawCommand`

If a layer type overrides `createDrawCommand` entirely (e.g. `TileLayer`), the automatic `a_pickId` / `gladly_apply_color` injection does not apply. Such layers are not pickable and `plot.pick()` will never return a hit for them. This is by design.

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
| `name` | string | Type identifier (e.g. `"points"`) |
| `xAxis` | string | Static default x-axis position (e.g. `"xaxis_bottom"`). Optional. |
| `xAxisQuantityKind` | string | Static x-axis quantity kind. Optional. |
| `yAxis` | string | Static default y-axis position (e.g. `"yaxis_left"`). Optional. |
| `yAxisQuantityKind` | string | Static y-axis quantity kind. Optional. |
| `colorAxisQuantityKinds` | Record&lt;string,string&gt; | Static dict mapping GLSL name suffix → quantity kind for color axes. Optional, defaults to `{}`. |
| `filterAxisQuantityKinds` | Record&lt;string,string&gt; | Static dict mapping GLSL name suffix → quantity kind for filter axes. Optional, defaults to `{}`. |
| `getAxisConfig` | function | `(parameters, data) => axisConfig` — dynamic axis config; overrides static fields wherever it returns a non-`undefined` value. Optional if statics cover all needed info. |
| `vert` | string | GLSL vertex shader |
| `frag` | string | GLSL fragment shader |
| `schema` | function | `(data) => JSONSchema` |
| `createLayer` | function | `(parameters, data) => Array<{ attributes, uniforms, primitive?, vertexCount?, instanceCount?, attributeDivisors?, blend? }>` — GPU data only; each element becomes one `Layer` |

**`getAxisConfig` return shape:**

```javascript
{
  xAxis?: string | null,                       // null suppresses the x axis
  xAxisQuantityKind?: string,
  yAxis?: string | null,                       // null suppresses the y axis
  yAxisQuantityKind?: string,
  colorAxisQuantityKinds?: Record<string, string>,  // suffix → quantity kind
  filterAxisQuantityKinds?: Record<string, string>, // suffix → quantity kind
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
| `u_pickingMode` | `float` | always | `0.0` = normal render, `1.0` = GPU pick pass |
| `u_pickLayerIndex` | `float` | always | Layer index encoded in the pick pass |
| `colorscale<suffix>` | `int` | color axes | Colorscale index; one per entry in `colorAxisQuantityKinds` |
| `color_range<suffix>` | `vec2` | color axes | `[min, max]` color range; one per color axis |
| `color_scale_type<suffix>` | `float` | color axes | `0.0` = linear, `1.0` = log; one per color axis |
| `filter_range<suffix>` | `vec4` | filter axes | `[min, max, hasMin, hasMax]`; one per filter axis |
| `filter_scale_type<suffix>` | `float` | filter axes | `0.0` = linear, `1.0` = log; one per filter axis |

**Automatically injected GLSL:**

All shaders must start with `#version 300 es` and use GLSL ES 3.0 syntax: `in`/`out` instead of `attribute`/`varying`, `out vec4 fragColor` instead of writing to `gl_FragColor`.

```glsl
// Always injected into vertex shader:
in float a_pickId;    // per-vertex id (non-instanced) or per-instance id (instanced)
out float v_pickId;   // passed to fragment shader; automatically assigned in main()

float normalize_axis(float v, vec2 domain, float scaleType)
// Maps v from data-space to [0, 1], handling both linear and log scales.

// Always injected into fragment shader:
in float v_pickId;

vec4 gladly_apply_color(vec4 color)
// In normal rendering: returns color unchanged.
// In a GPU pick pass (u_pickingMode > 0.5): ignores color and returns the
// pick-encoded RGBA for this vertex (layer index + data index).
// Call this as the last step before assigning fragColor.

// Injected when color axes are present:
vec4 map_color(int cs, vec2 range, float value)
// Maps value to RGBA using colorscale cs and a linear range.

vec4 map_color_s(int cs, vec2 range, float value, float scaleType, float useAlpha)
// Like map_color but handles log scale (log() applied when scaleType > 0.5).
// When useAlpha > 0.5, replaces the output alpha with the normalized value t
// (making low values fade to transparent).
// Calls gladly_apply_color() internally — no explicit call needed in the shader.

// Injected when filter axes are present (vertex shader only):
bool filter_in_range(vec4 range, float value)
// Returns false when value is outside the filter bounds.
// range: [min, max, hasMin, hasMax]; open bounds (hasMin/hasMax == 0) always pass.
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl, layer)` | Compiles shaders and returns a regl draw function; maps color/filter axis uniforms via `colorAxisQuantityKinds`/`filterAxisQuantityKinds` suffixes |
| `schema(data)` | Returns JSON Schema for layer parameters |
| `createLayer(parameters, data)` | Calls user factory + `resolveAxisConfig`, returns a ready-to-render Layer |
| `resolveAxisConfig(parameters, data)` | Merges static declarations with `getAxisConfig` output (dynamic wins on non-`undefined`) |

---

### `createLayer` Return Value

`createLayer` must return an **array** of GPU config objects. Each element becomes one rendered `Layer`. Returning multiple elements renders multiple draw calls from one layer spec (e.g. one per data series).

Each element in the array:

```javascript
{
  // GPU attribute values — keyed by GLSL attribute name.
  // Each value is one of:
  //   - Float32Array: vertex buffer for a single tile (wrapped to [Float32Array] internally).
  //   - Float32Array[]: one typed array per tile — enables tiled rendering (N draw calls).
  //   - string: a column name resolved from the plot's current data to ColumnData.
  //   - ColumnData: (ArrayColumn / TextureColumn / GlslColumn) — resolved to GPU texture or GLSL expr.
  //   - Computed expression { computationName: params }: resolved to ColumnData.
  // Non-Float32Array values become GPU texture samples injected into the vertex shader as:
  //   float attrName = sampleColumn(u_col_attrName, a_pickId);
  // See docs/extension-api/Computations.md for details.
  // See docs/tiled-data.md for the tiled rendering model (Float32Array[] and multi-tile ColumnData).
  attributes: {
    x: 'xData',                                   // column name string
    y: Float32Array,                               // plain vertex buffer (single tile)
    z: [tile0Array, tile1Array],                   // tiled buffer — two draw calls
    color_data: 'temperature',                     // column name → GPU texture sample
    count: { histogram: { input: 'norm', bins } }, // computed attribute expression
    // ...
  },

  // Layer-specific GPU uniforms (in addition to the auto-provided ones).
  // Keys are the GLSL-visible uniform names.
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

Values in `attributes` are normally `Float32Array`. They may also be **computed attribute expressions** — single-key objects `{ computationName: params }` that the framework resolves into a GPU-sampled texture or injected GLSL expression. See [Computed Attributes](Computations.md) for the full API and built-in computations.

---

### `registerColorscale(name, stops, nanColor)`

Registers a custom 1D colorscale as a list of color stops. The stops are uploaded to a GPU texture; the library handles the GLSL lookup automatically.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | — | Unique colorscale name |
| `stops` | `[t, r, g, b][]` | — | Array of color stops. Each entry is `[t, r, g, b]` where `t ∈ [0, 1]` is the position and `r,g,b ∈ [0, 1]` are the color components. Values between stops are linearly interpolated. |
| `nanColor` | `[r, g, b]` | `[0.5, 0.5, 0.5]` | Color used for NaN values |

```javascript
import { registerColorscale } from './src/index.js'

registerColorscale("my_scale", [
  [0.0, 0.0, 0.0, 1.0],   // t=0: blue
  [0.5, 0.5, 0.0, 0.5],   // t=0.5: mix
  [1.0, 1.0, 0.0, 0.0],   // t=1: red
])
```

For 2D (bivariate) colorscales, use `register2DColorscale(name, glslFn)` — 2D colorscales are still GLSL-based and receive a `vec2 t` argument.

---

### `getRegisteredColorscales()`

Returns a `Map` of all registered 1D colorscale names to their internal data (stops and GPU texture). Not intended for direct shader use — colorscales are referenced by name in `config.axes[qk].colorscale`.

---

### `buildColorGlsl()`

Returns the complete GLSL color dispatch string (all colorscale functions + `map_color` dispatcher). Injected automatically by `createDrawCommand`; only needed for custom WebGL integrations.

---

### `buildFilterGlsl()`

Returns the GLSL `filter_in_range` helper string. Injected automatically by `createDrawCommand`; only needed for custom WebGL integrations.

---

## Constants Reference

### `AXES`

All 12 registered spatial axis names, including 3D and back-face axes:

```javascript
[
  "xaxis_bottom", "xaxis_top", "xaxis_bottom_back", "xaxis_top_back",
  "yaxis_left",   "yaxis_right", "yaxis_left_back",  "yaxis_right_back",
  "zaxis_bottom_left", "zaxis_bottom_right", "zaxis_top_left", "zaxis_top_right"
]
```

For schemas that should only accept standard 2D axes, use `AXES_2D`:

```javascript
["xaxis_bottom", "xaxis_top", "yaxis_left", "yaxis_right"]
```
