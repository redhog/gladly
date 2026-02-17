# Gladly API Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library that uses WebGL (via [regl](https://github.com/regl-project/regl)) for high-performance data rendering and [D3.js](https://d3js.org/) for interactive axes and zoom controls.

The library features a **declarative API** where you register layer types once and then create plots by specifying data and layer configurations.

---

## Quick Start

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

// 1. Register layer types (once at startup)
registerLayerType("scatter", scatterLayerType)

// 2. Prepare data as Float32Arrays
const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

// 3. Create plot with container element
const plot = new Plot(document.getElementById("plot-container"))

// 4. Apply configuration and data
plot.update({
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },
      yaxis_left: { min: 0, max: 50 }
    }
  },
  data: { x, y, v }
})
```

**HTML Setup:**
```html
<div id="plot-container" style="position: relative; width: 800px; height: 600px;"></div>
```

The Plot will automatically create and manage the canvas and SVG elements inside the container. Width and height are automatically detected from the container's `clientWidth` and `clientHeight`. The plot automatically handles resizing via ResizeObserver.

---

## Data Model

### LayerType

A **LayerType** defines how data is visualized. Each LayerType specifies:

- **X-axis and Y-axis quantity units** - Each spatial axis has a quantity unit (e.g., "meters", "volts", "log10")
- **Color axis quantity kinds** - Named slots mapping a data dimension to a color scale (e.g., slot `v` → quantity kind `"temperature"`)
- **Filter axis quantity kinds** - Named slots mapping a data dimension to a linkable range filter (e.g., slot `z` → quantity kind `"depth"`)
- **GLSL shaders** - Vertex and fragment shaders that define how data is rendered on the GPU
- **Data attributes** - Which fields from your data are passed to the shaders
- **Schema** - JSON Schema definition for layer parameters
- **Factory method** - How to create a layer from parameters and data

### Layer

A **Layer** is an instance of a LayerType with specific data. Layers are created automatically by the Plot constructor from your declarative configuration.

Each layer has:
- **A LayerType** - Which defines how to render the data
- **Data** - Type-specific data in typed arrays (always `Float32Array`)
- **Axis assignment** - Which spatial axes to use (e.g., "xaxis_bottom", "yaxis_left")
- **Color axes** - Named slots mapping data arrays to color scales via quantity kinds
- **Filter axes** - Named slots mapping data arrays to range filters via quantity kinds

### Data Format

**All data must be typed arrays** (`Float32Array`) for GPU efficiency. This enables direct GPU memory mapping without conversion overhead.

```javascript
// ✅ Correct
const data = {
  x: new Float32Array([1, 2, 3]),
  y: new Float32Array([4, 5, 6]),
  v: new Float32Array([0.1, 0.5, 0.9])
}

// ❌ Incorrect - will throw error
const badData = {
  x: [1, 2, 3],  // Regular array not allowed
  y: [4, 5, 6]
}
```

---

## Making a Plot

### Basic Usage

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

// Register the scatter layer type
registerLayerType("scatter", scatterLayerType)

// Prepare data
const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

// Create plot
const plot = new Plot(document.getElementById("plot-container"))

// Apply configuration and data
plot.update({
  data: { x, y, v },  // Data object with arbitrary structure
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }  // References data properties
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },  // Optional: specify domain
      yaxis_left: { min: 0, max: 50 }
    }
  }
})
```

### Auto Domain Calculation

If you omit the `axes` parameter (or omit specific axes), domains are automatically calculated from the data:

```javascript
const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ]
    // No axes parameter - domains auto-calculated from data
  }
})
```

### Multi-Layer Plot

```javascript
const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { x1, y1, v1, x2, y2, v2 },
  config: {
    layers: [
      { scatter: { xData: "x1", yData: "y1", vData: "v1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
      { scatter: { xData: "x2", yData: "y2", vData: "v2", xAxis: "xaxis_top", yAxis: "yaxis_right" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 10 },
      yaxis_left: { min: 0, max: 5 }
      // xaxis_top and yaxis_right auto-calculated
    }
  }
})
```

---

## Making a LayerType

To create a custom LayerType, define it with custom GLSL shaders, a schema, and a factory method.

### Without Color Axes

A simple layer type that renders fixed-color dots:

```javascript
import { LayerType } from './src/index.js'
import { registerLayerType, AXES } from './src/index.js'

const redDotsType = new LayerType({
  name: "red_dots",
  axisQuantityUnits: {x: "meters", y: "volts"},

  // Vertex shader: transform data coordinates to screen space
  vert: `
    precision mediump float;
    attribute float x, y;
    uniform vec2 xDomain, yDomain;

    void main() {
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 6.0;
    }
  `,

  // Fragment shader: fixed red color
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
      // No colorAxes: no color axis for this layer type
    }
  }
})

registerLayerType("red_dots", redDotsType)
```

### With Color Axes

A layer type that maps a data value to color via a colorscale:

```javascript
import { LayerType, registerLayerType, AXES } from './src/index.js'

const heatDotsType = new LayerType({
  name: "heat_dots",
  axisQuantityUnits: { x: "meters", y: "volts" },

  // Declare color axis slot "v"; null = quantity kind resolved dynamically
  colorAxisQuantityKinds: { v: null },

  // Vertex shader: pass color value through as a varying
  vert: `
    precision mediump float;
    attribute float x, y, v;
    uniform vec2 xDomain, yDomain;
    varying float value;

    void main() {
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 6.0;
      value = v;
    }
  `,

  // Fragment shader: use map_color() - injected automatically when color axes are present
  frag: `
    precision mediump float;
    uniform int colorscale_v;    // colorscale index for slot "v"
    uniform vec2 color_range_v;  // [min, max] range for slot "v"
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
      vData: { type: "string", description: "Property name for color values; becomes the color axis quantity kind" },
      xAxis: { type: "string", enum: AXES.filter(a => a.includes("x")), default: "xaxis_bottom" },
      yAxis: { type: "string", enum: AXES.filter(a => a.includes("y")), default: "yaxis_left" }
    },
    required: ["xData", "yData", "vData"]
  }),

  // Resolve the quantity kind for slot "v" dynamically from parameters
  getColorAxisQuantityKinds: function(parameters, data) {
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
          quantityKind: vData,     // axis config key; links data to range/colorscale
          data: data[vData],       // Float32Array used for auto-domain calculation
          colorscale: "viridis"    // default colorscale (can be overridden in config)
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
      // Override color axis range and colorscale (optional)
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

### Dynamic Spatial Axis Unit Resolution

Layer types can calculate axis units dynamically based on parameters or data by setting an axis unit to `null` and providing a `getAxisQuantityUnits` method:

```javascript
const dynamicScatterType = new LayerType({
  name: "dynamic_scatter",
  axisQuantityUnits: {x: null, y: "meters"},  // x unit will be calculated dynamically

  // Calculate axis units based on parameters and data
  getAxisQuantityUnits: function(parameters, data) {
    // Can inspect parameters to determine unit
    const xUnit = parameters.xUnit || "meters"

    // Can also inspect data if needed
    // const xUnit = data.xUnitName ? data.xUnitName : "meters"

    return {x: xUnit, y: null}  // y is already static, so return null or omit
  },

  vert: `/* ... */`,
  frag: `/* ... */`,

  schema: () => ({
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      vData: { type: "string" },
      xUnit: {
        type: "string",
        enum: ["meters", "volts", "m/s", "ampere"],
        default: "meters",
        description: "Unit for x-axis"
      }
    },
    required: ["xData", "yData", "vData"]
  }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters

    // Return config - axis units resolved automatically from axisQuantityUnits + getAxisQuantityUnits
    return {
      attributes: { x: data[xData], y: data[yData], v: data[vData] },
      uniforms: {},
      xAxis,
      yAxis
    }
  }
})
```

**Validation:**
- If a layer's resolved axis units conflict with units already assigned to that axis, the error is thrown during `plot.update()`
- The plot's previous configuration is preserved on error, allowing graceful error handling
- Validation happens at runtime when layers are processed, not during JSON schema validation

**Key Points:**
- **Quantity Units**: `axisQuantityUnits` has `x` and `y` properties that must match one of: "meters", "volts", "m/s", "ampere", "log10", or `null` for dynamic resolution
- **Dynamic Units**: Set an axis unit to `null` and provide `getAxisQuantityUnits(parameters, data)` to calculate units based on layer configuration
- **Uniforms**: `xDomain` and `yDomain` are automatically provided by the library
- **Attributes**: Map to your data fields using accessor functions
- **Schema**: Returns a JSON Schema (Draft 2020-12) defining expected parameters
- **createLayer**: Returns a plain config object; `LayerType.createLayer()` handles `Layer` construction and unit resolution automatically

---

## Color Axes

Color axes map a numeric data dimension to a color by looking up a colorscale. They work in parallel to spatial axes: each color axis has a **quantity kind** (a string identifier) and a **range** [min, max] that is either auto-calculated from data or overridden in the plot config.

### Concepts

| Term | Description |
|------|-------------|
| **Slot** | A named position in the layer (e.g., `"v"`). One slot per color dimension. The slot name determines the GLSL uniform names (`colorscale_v`, `color_range_v`). |
| **Quantity kind** | A string identifier for the color axis (e.g., `"temperature"`, `"v1"`). Multiple layers can share the same quantity kind, automatically sharing a common range. |
| **Colorscale** | A named GLSL color function (e.g., `"viridis"`, `"plasma"`). Set a default in `createLayer`; override per-plot in `config.axes`. |

### How the Plot Handles Color Axes

1. **Registration**: When processing layers, the Plot registers each color axis quantity kind with the `ColorAxisRegistry`.
2. **Auto-domain**: The Plot scans all layer data arrays sharing the same quantity kind and calculates [min, max].
3. **Override**: The `config.axes` object can override range and colorscale for any quantity kind:
   ```javascript
   axes: {
     temperature: { min: 20, max: 80, colorscale: "coolwarm" }
   }
   ```
4. **Rendering**: The Plot passes `colorscale_<slot>` (int index) and `color_range_<slot>` (vec2) as uniforms to the shader.

### Declaring Color Axes in a LayerType

Use `colorAxisQuantityKinds` to declare which slots a layer type uses. Set the value to `null` for dynamic resolution:

```javascript
colorAxisQuantityKinds: { v: null }   // slot "v", quantity kind resolved per-layer
```

Provide `getColorAxisQuantityKinds` to resolve null slots:

```javascript
getColorAxisQuantityKinds: function(parameters, data) {
  return { v: parameters.vData }   // use the data property name as quantity kind
}
```

### Providing Color Axis Data in createLayer

The `createLayer` factory returns a `colorAxes` map. The Plot uses `data` for auto-domain calculation:

```javascript
createLayer: function(parameters, data) {
  return {
    attributes: { ... },
    uniforms: {},
    xAxis, yAxis,
    colorAxes: {
      v: {
        quantityKind: parameters.vData,  // links to a shared color axis
        data: data[parameters.vData],    // Float32Array for auto-domain
        colorscale: "viridis"            // default; overridable in config.axes
      }
    }
  }
}
```

### GLSL Integration

When a layer has one or more color axes, `createDrawCommand` automatically:
1. Injects all registered colorscale GLSL functions into the shader
2. Injects the `map_color(int cs, vec2 range, float value)` dispatch function
3. Adds `colorscale_<slot>` and `color_range_<slot>` uniforms

Use `map_color` in your fragment shader:

```glsl
precision mediump float;
uniform int colorscale_v;
uniform vec2 color_range_v;
varying float value;

void main() {
  gl_FragColor = map_color(colorscale_v, color_range_v, value);
}
```

### Colorscales Provided by Default

Gladly registers all standard matplotlib colorscales on import. See the [Colorscales Reference](#colorscales) in the Constants section for the full list.

Use `registerColorscale(name, glslFn)` to add custom colorscales.

---

## Filter Axes

Filter axes let a layer declare a named, linkable range that the shader uses to `discard` out-of-range points. They work in parallel to spatial and color axes: each filter axis has a **quantity kind** (a string identifier) and an optional **range** [min, max] where either or both bounds may be absent (open interval). The range is passed to the shader as a `vec4` uniform; no visual axis is drawn.

### Concepts

| Term | Description |
|------|-------------|
| **Slot** | A named position in the layer (e.g., `"z"`). The slot name determines the GLSL uniform name (`filter_range_z`). |
| **Quantity kind** | A string identifier for the filter axis (e.g., `"depth"`, `"time"`). Multiple layers can share the same quantity kind, automatically sharing a common range. Filter axes with the same quantity kind can be linked between plots. |
| **Open bound** | A missing `min` or `max` in the config means that bound is not enforced. |

### How the Plot Handles Filter Axes

1. **Registration**: When processing layers, the Plot registers each filter axis quantity kind with the `FilterAxisRegistry`.
2. **Config override**: The `config.axes` object can set either or both bounds for any quantity kind. Both bounds are optional:
   ```javascript
   axes: {
     depth: { min: 10, max: 500 }  // closed
     depth: { min: 10 }            // open upper bound
     depth: { max: 500 }           // open lower bound
   }
   ```
3. **Default**: Open bounds — no filtering until config specifies a range.
4. **Rendering**: The Plot passes `filter_range_<slot>` (vec4) as a uniform to the shader.

### Declaring Filter Axes in a LayerType

Use `filterAxisQuantityKinds` to declare which slots a layer type uses. Set the value to `null` for dynamic resolution:

```javascript
filterAxisQuantityKinds: { z: null }   // slot "z", quantity kind resolved per-layer
```

Provide `getFilterAxisQuantityKinds` to resolve null slots:

```javascript
getFilterAxisQuantityKinds: function(parameters, data) {
  return { z: parameters.zData }   // use the data property name as quantity kind
}
```

### Providing Filter Axis Data in createLayer

The `createLayer` factory returns a `filterAxes` map. The `data` array is not used for auto-domain (filter axes default to open bounds), but is stored in the layer for reference:

```javascript
createLayer: function(parameters, data) {
  return {
    attributes: { ... },
    uniforms: {},
    xAxis, yAxis,
    filterAxes: {
      z: {
        quantityKind: parameters.zData,  // links to a shared filter axis
        data: data[parameters.zData]     // Float32Array — the per-point values to test
      }
    }
  }
}
```

### GLSL Integration

When a layer has one or more filter axes, `createDrawCommand` automatically:
1. Adds a `filter_range_<slot>` vec4 uniform for each slot
2. Injects the `filter_in_range(vec4, float)` GLSL helper function

Use `filter_in_range` in your vertex or fragment shader to discard points:

```glsl
precision mediump float;
uniform vec4 filter_range_z;  // [min, max, hasMin, hasMax]
attribute float z;
// ...

void main() {
  if (!filter_in_range(filter_range_z, z)) {
    // Move point out of clip space (vertex shader discard equivalent)
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // ... normal position calculation
}
```

Or in a fragment shader (if z is passed as a varying):

```glsl
if (!filter_in_range(filter_range_z, z_value)) discard;
```

### With Color and Filter Axes

A layer type can combine color and filter axes:

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
      float nx = (x - xDomain.x)/(xDomain.y - xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y - yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
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

  getAxisQuantityUnits: (p) => ({ x: p.xData, y: p.yData }),
  getColorAxisQuantityKinds: (p) => ({ v: p.vData }),
  getFilterAxisQuantityKinds: (p) => ({ z: p.zData }),

  schema: () => ({ /* ... */ }),

  createLayer: function(parameters, data) {
    const { xData, yData, vData, zData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      attributes: { x: data[xData], y: data[yData], v: data[vData], z: data[zData] },
      uniforms: {},
      xAxis, yAxis,
      colorAxes: { v: { quantityKind: vData, data: data[vData], colorscale: "viridis" } },
      filterAxes: { z: { quantityKind: zData, data: data[zData] } }
    }
  }
})
```

**Usage:**
```javascript
plot.update({
  data: { x, y, v, depth },
  config: {
    layers: [
      { filtered_scatter: { xData: "x", yData: "y", vData: "v", zData: "depth" } }
    ],
    axes: {
      v: { min: 0, max: 1, colorscale: "plasma" },
      depth: { min: 100, max: 800 }  // only show points where 100 ≤ depth ≤ 800
    }
  }
})
```

---

## Installation

```bash
npm install regl d3
```

Then import Gladly components:

```javascript
import { Plot, LayerType, registerLayerType, scatterLayerType } from './src/index.js'
```

---

## API Reference

### Plot

The main plotting container that manages WebGL rendering and SVG axes.

**Constructor:**
```javascript
new Plot(container)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Container element (e.g., div) where canvas and SVG will be created. Must have explicit dimensions via CSS. Dimensions are auto-detected from `clientWidth` and `clientHeight`. |

Creates an empty plot with canvas and SVG elements. No rendering occurs until `update()` is called with both config and data. The plot automatically handles resizing via ResizeObserver.

**Instance Methods:**

#### `update({ config, data })`

Updates the plot with new configuration and/or data. Both parameters are optional.

```javascript
plot.update({ config, data })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | Plot configuration containing `layers` and optional `axes` |
| `config.layers` | array | Array of layer specifications (see below) |
| `config.axes` | object | Optional domain overrides for spatial and color axes (see below) |
| `data` | object | Data object with arbitrary structure (all values must be Float32Arrays) |

**Behavior:**
- If only `config` is provided, stores config but doesn't render (waits for data)
- If only `data` is provided, updates data and re-renders with existing config
- If both provided, updates both and renders
- If neither provided, re-renders with existing config/data (same as `forceUpdate()`)

**Width and Height:**
- Automatically detected from container's `clientWidth` and `clientHeight`
- Updates automatically on container resize via ResizeObserver

**Layer Specification Format:**

Each layer is an object with a single key (the layer type name) mapping to parameters:

```javascript
config: {
  layers: [
    { layerTypeName: { param1: value1, param2: value2, ... } }
  ]
}
```

**Axes Configuration Format:**

```javascript
config: {
  axes: {
    // Spatial axes
    xaxis_bottom: { min: 0, max: 100 },
    xaxis_top: { min: 0, max: 100 },
    yaxis_left: { min: 0, max: 50 },
    yaxis_right: { min: 0, max: 50 },
    // Color axes: key is the quantity kind used by the layer's color slot
    temperature: { min: 0, max: 100, colorscale: "plasma" },
    // Filter axes: key is the quantity kind used by the layer's filter slot
    // Both min and max are optional — omit either for an open bound
    depth: { min: 10 },        // only lower bound: discard points with depth < 10
    depth: { max: 500 },       // only upper bound: discard points with depth > 500
    depth: { min: 10, max: 500 } // closed range
  }
}
```

Omitted spatial axes will have domains auto-calculated from data. Color axis keys are the quantity kind strings declared by layer types (e.g., the value of `vData` in the built-in scatter layer type). Filter axes default to fully open bounds (no filtering) if not specified in config.

#### `forceUpdate()`

Forces a re-render with the current configuration and data. Equivalent to calling `update({})` with no parameters.

```javascript
plot.forceUpdate()
```

**Static Methods:**

| Method | Description |
|--------|-------------|
| `Plot.schema()` | Returns JSON Schema for the plot configuration object (layers and axes) based on registered layer types |

**Instance Methods:**

| Method | Description |
|--------|-------------|
| `update({ config, data })` | Updates the plot with new configuration and/or data. See details below. |
| `forceUpdate()` | Re-renders with current configuration and data. |
| `destroy()` | Cleans up the plot, removing event listeners and destroying WebGL context. |

---

### registerLayerType

Registers a layer type with a name for use in declarative plots.

**Syntax:**
```javascript
registerLayerType(name, layerType)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique name for the layer type |
| `layerType` | LayerType | LayerType instance to register |

**Example:**
```javascript
import { registerLayerType, scatterLayerType } from './src/index.js'
registerLayerType("scatter", scatterLayerType)
```

---

### getLayerType

Retrieves a registered layer type by name.

**Syntax:**
```javascript
getLayerType(name)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Name of the layer type |

**Returns:** LayerType instance

---

### getRegisteredLayerTypes

Returns an array of all registered layer type names.

**Syntax:**
```javascript
getRegisteredLayerTypes()
```

**Returns:** Array of strings

---

### Layer

Represents a data layer to be visualized. Layers are typically created automatically by the Plot constructor, but can also be created manually.

**Constructor:**
```javascript
new Layer({ type, attributes, uniforms, xAxis, yAxis, xAxisQuantityUnit, yAxisQuantityUnit, colorAxes, filterAxes })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | LayerType | required | LayerType defining rendering behavior |
| `attributes` | object | required | GPU attributes object with Float32Array properties |
| `uniforms` | object | required | GPU uniforms object with scalars/arrays |
| `xAxis` | string | `"xaxis_bottom"` | Axis name for x-coordinate |
| `yAxis` | string | `"yaxis_left"` | Axis name for y-coordinate |
| `xAxisQuantityUnit` | string | required | Resolved x-axis quantity unit |
| `yAxisQuantityUnit` | string | required | Resolved y-axis quantity unit |
| `colorAxes` | object | `{}` | Map of slot names to color axis entries (see below) |
| `filterAxes` | object | `{}` | Map of slot names to filter axis entries (see below) |

**Color Axes Entry Format:**

Each key in `colorAxes` is a slot name (matching a GLSL uniform suffix, e.g., `"v"`). The value is:

```javascript
{
  quantityKind: "temperature",  // string identifying the color axis (becomes the axes config key)
  data: Float32Array,           // data values to be color-mapped
  colorscale: "plasma"          // optional: preferred colorscale name
}
```

**Filter Axes Entry Format:**

Each key in `filterAxes` is a slot name (matching a GLSL uniform suffix, e.g., `"z"`). The value is:

```javascript
{
  quantityKind: "depth",  // string identifying the filter axis (becomes the axes config key)
  data: Float32Array      // per-point data values used to evaluate the filter
}
```

Layers are typically created by calling `layerType.createLayer()`, which constructs this automatically.

**Attributes Object:**
- Contains GPU attribute data as Float32Array (e.g., `{ x: Float32Array, y: Float32Array, v: Float32Array }`)
- Property names must match GLSL attribute names in shaders
- All arrays must be Float32Array (validation enforced)
- All arrays must be same length

**Uniforms Object:**
- Contains GPU uniform data as scalars, typed arrays, or lists
- Property names must match GLSL uniform names in shaders
- Can be empty object if no layer-specific uniforms needed

---

### LayerType

Defines how a layer is rendered using custom GLSL shaders.

**Constructor:**
```javascript
new LayerType({ name, axisQuantityUnits, colorAxisQuantityKinds, filterAxisQuantityKinds, vert, frag, schema, createLayer, getAxisQuantityUnits, getColorAxisQuantityKinds, getFilterAxisQuantityKinds })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Type name (e.g., "scatter") |
| `axisQuantityUnits` | object | Spatial axis quantity units: `{x: string\|null, y: string\|null}`. Use `null` for dynamic resolution. |
| `colorAxisQuantityKinds` | object | Color axis slot declarations: `{ [slotName]: string\|null }`. Use `null` for dynamic resolution via `getColorAxisQuantityKinds`. Defaults to `{}` (no color axes). |
| `filterAxisQuantityKinds` | object | Filter axis slot declarations: `{ [slotName]: string\|null }`. Use `null` for dynamic resolution via `getFilterAxisQuantityKinds`. Defaults to `{}` (no filter axes). |
| `vert` | string | GLSL vertex shader code |
| `frag` | string | GLSL fragment shader code |
| `schema` | function | Function returning JSON Schema for parameters |
| `createLayer` | function | Function to create Layer config from parameters and data |
| `getAxisQuantityUnits` | function | Optional: `(parameters, data) => {x: string, y: string}` for dynamic spatial unit resolution |
| `getColorAxisQuantityKinds` | function | Optional: `(parameters, data) => { [slotName]: string }` for dynamic color axis quantity kind resolution |
| `getFilterAxisQuantityKinds` | function | Optional: `(parameters, data) => { [slotName]: string }` for dynamic filter axis quantity kind resolution |

**Note:** Attributes and uniforms are defined dynamically by the Layer instance created by `createLayer`. The `createDrawCommand` method inspects the layer's `attributes`, `uniforms`, `colorAxes`, and `filterAxes` objects to build the WebGL configuration.

**Shader Uniforms (automatically provided):**
- `xDomain` (vec2): [min, max] of x-axis domain
- `yDomain` (vec2): [min, max] of y-axis domain
- `count` (int): Number of data points
- `colorscale_<slot>` (int): Colorscale index for each color axis slot (e.g., `colorscale_v`)
- `color_range_<slot>` (vec2): [min, max] range for each color axis slot (e.g., `color_range_v`)
- `filter_range_<slot>` (vec4): `[min, max, hasMin, hasMax]` for each filter axis slot (e.g., `filter_range_z`). `hasMin`/`hasMax` are `1.0` when the bound is active and `0.0` when the bound is open.

**GLSL Functions (automatically injected when the relevant axes are present):**

```glsl
// Injected when color axes are present:
vec4 map_color(int cs, vec2 range, float value)
```
Normalizes `value` into `[0, 1]` over `range` and returns the RGBA color from colorscale `cs`.

```glsl
// Injected when filter axes are present:
bool filter_in_range(vec4 range, float value)
```
Returns `false` (point should be discarded) if `value` falls outside any active bound in `range`. Use with `discard` in vertex or fragment shaders.

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl, layer)` | Compiles shaders into a regl draw command; injects color and filter GLSL helpers automatically |
| `schema()` | Returns JSON Schema (Draft 2020-12) for layer parameters |
| `createLayer(parameters, data)` | Creates a Layer instance from parameters and data object |
| `getAxisQuantityUnits(parameters, data)` | Returns `{x: string, y: string}` with dynamically resolved spatial units (only needed if some units are `null`) |
| `resolveAxisQuantityUnits(parameters, data)` | Returns `{x: string, y: string}` with fully resolved spatial units (merges static and dynamic) |
| `getColorAxisQuantityKinds(parameters, data)` | Returns `{ [slotName]: string }` with dynamically resolved color axis quantity kinds (only needed if some entries are `null`) |
| `resolveColorAxisQuantityKinds(parameters, data, factoryColorAxes)` | Returns fully resolved color axes map, merging static declarations with factory-provided entries |
| `getFilterAxisQuantityKinds(parameters, data)` | Returns `{ [slotName]: string }` with dynamically resolved filter axis quantity kinds (only needed if some entries are `null`) |
| `resolveFilterAxisQuantityKinds(parameters, data, factoryFilterAxes)` | Returns fully resolved filter axes map, merging static declarations with factory-provided entries |

---

### scatterLayerType

A pre-configured LayerType for scatter plots.

**Configuration:**
- **Name:** "scatter"
- **Spatial units:** dynamic — resolved from `xData` and `yData` parameter names as quantity kinds
- **Color axis:** slot `v`, quantity kind resolved from `vData` parameter name; default colorscale "viridis"
- **Attributes:** x, y, v (value for color mapping)
- **Point Size:** 4.0 pixels

**Parameters Schema:**
- `xData` (required): Property name in data object for x coordinates; also used as the x-axis quantity kind
- `yData` (required): Property name in data object for y coordinates; also used as the y-axis quantity kind
- `vData` (required): Property name in data object for color values; also used as the color axis quantity kind
- `xAxis` (optional): Which x-axis to use (default: "xaxis_bottom")
- `yAxis` (optional): Which y-axis to use (default: "yaxis_left")

**Usage:**
```javascript
import { registerLayerType, scatterLayerType } from './src/index.js'
registerLayerType("scatter", scatterLayerType)

const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ]
  }
})
```

---

### registerColorscale

Registers a custom colorscale for use in color axes.

**Syntax:**
```javascript
registerColorscale(name, glslFn)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique colorscale name (e.g., `"my_scale"`) |
| `glslFn` | string | Complete GLSL function string: `vec4 colorscale_<name>(float t) { ... }` where `t` is in [0, 1] |

**Example:**
```javascript
import { registerColorscale } from './src/index.js'

registerColorscale("my_scale", `
  vec4 colorscale_my_scale(float t) {
    return vec4(t, 1.0 - t, 0.5, 1.0);
  }
`)
```

The function must be named `colorscale_<name>` and accept a single `float t` in [0, 1], returning `vec4` RGBA.

---

### getRegisteredColorscales

Returns a Map of all registered colorscale names to their GLSL function strings.

**Syntax:**
```javascript
getRegisteredColorscales()
```

**Returns:** `Map<string, string>`

---

### buildColorGlsl

Builds the complete GLSL color dispatch code for all registered colorscales.

**Syntax:**
```javascript
buildColorGlsl()
```

**Returns:** string — GLSL source including all `colorscale_<name>` functions and the `map_color(int cs, vec2 range, float value)` dispatcher. This is automatically injected by `createDrawCommand` when a layer has color axes; you only need this if building custom WebGL integrations.

---

### buildFilterGlsl

Returns the GLSL helper function used by filter axes.

**Syntax:**
```javascript
buildFilterGlsl()
```

**Returns:** string — GLSL source for `filter_in_range(vec4 range, float value)`. This is automatically injected by `createDrawCommand` when a layer has filter axes; you only need this if building custom WebGL integrations.

The `range` vec4 encodes `[min, max, hasMin, hasMax]` where `hasMin`/`hasMax` are `1.0` when the bound is active and `0.0` for an open bound. Returns `false` when the value should be discarded.

---

### AxisRegistry

Manages D3 scales for multiple axes and enforces unit consistency. **Note:** AxisRegistry is created automatically by Plot; you typically don't need to interact with it directly.

**Available Axes:**
- `"xaxis_bottom"` - Bottom x-axis
- `"xaxis_top"` - Top x-axis
- `"yaxis_left"` - Left y-axis
- `"yaxis_right"` - Right y-axis

**Available Units:**
- `"meters"` - Linear scale, label: "Meters"
- `"volts"` - Linear scale, label: "Volts"
- `"m/s"` - Linear scale, label: "m/s"
- `"ampere"` - Linear scale, label: "Ampere"
- `"log10"` - Logarithmic scale, label: "Log10"

---

## Interaction

### Zoom and Pan

Gladly supports advanced zoom and pan interactions:

- **Plot area zoom/pan:** Mouse wheel and drag in the plot area zooms/pans all axes
- **Axis-specific zoom/pan:** Mouse wheel and drag over an axis zooms/pans only that axis
- **Zoom extent:** 0.5x to 50x
- **Wheel behavior:** Pure zoom (no pan)
- **Drag behavior:** Pan with simultaneous zoom support

The zoom behavior keeps the data point under the mouse cursor fixed during zoom operations.

---

## Advanced Examples

### Multi-Axis Plot with Different Units

```javascript
import { Plot, LayerType, Layer, registerLayerType } from './src/index.js'

// Define layer types with different units
const tempType = new LayerType({
  name: "temperature",
  axisQuantityUnits: {x: "meters", y: "volts"},
  // ... shaders and attributes
  schema: () => ({ /* ... */ }),
  createLayer: function(params, data) { /* ... */ }
})

const pressureType = new LayerType({
  name: "pressure",
  axisQuantityUnits: {x: "meters", y: "log10"},
  // ... shaders and attributes
  schema: () => ({ /* ... */ }),
  createLayer: function(params, data) { /* ... */ }
})

registerLayerType("temperature", tempType)
registerLayerType("pressure", pressureType)

const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { time, temp, pressure },
  config: {
    layers: [
      { temperature: { xData: "time", yData: "temp", vData: "temp", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
      { pressure: { xData: "time", yData: "pressure", vData: "pressure", xAxis: "xaxis_bottom", yAxis: "yaxis_right" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 100 },
      yaxis_left: { min: 0, max: 100 },
      yaxis_right: { min: 0.1, max: 1000 }  // Log scale
    }
  }
})
```

### Large Dataset (100k points)

```javascript
// Generate 100,000 points
const N = 100000
const x = new Float32Array(N)
const y = new Float32Array(N)
const v = new Float32Array(N)

for (let i = 0; i < N; i++) {
  x[i] = Math.random() * 1000
  y[i] = Math.sin(x[i] * 0.01) * 50 + Math.random() * 10
  v[i] = Math.random()
}

registerLayerType("scatter", scatterLayerType)

const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ]
    // Domains auto-calculated
  }
})

// GPU handles rendering 100k points efficiently
```

---

## Complete Working Example

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; }
    #canvas { position: absolute; }
    #svg {
      position: absolute;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <canvas id="canvas" width="800" height="600"></canvas>
  <svg id="svg" width="800" height="600"></svg>

  <script type="module">
    import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

    // Register layer type
    registerLayerType("scatter", scatterLayerType)

    // Generate data
    const N = 5000
    const x = new Float32Array(N)
    const y = new Float32Array(N)
    const v = new Float32Array(N)

    for (let i = 0; i < N; i++) {
      x[i] = Math.random() * 100
      y[i] = Math.random() * 50
      v[i] = Math.random()
    }

    // Create plot with declarative API
    const plot = new Plot(document.getElementById("plot-container"))
    plot.update({
      data: { x, y, v },
      config: {
        layers: [
          { scatter: { xData: "x", yData: "y", vData: "v" } }
        ],
        axes: {
          xaxis_bottom: { min: 0, max: 100 },
          yaxis_left: { min: 0, max: 50 }
        }
      }
    })
  </script>
</body>
</html>
```

---

## Constants Reference

### AXES

Available axis positions:
```javascript
["xaxis_bottom", "xaxis_top", "yaxis_left", "yaxis_right"]
```

### AXIS_UNITS

Unit definitions with labels and scale types:
```javascript
{
  meters: { label: "Meters", scale: "linear" },
  volts: { label: "Volts", scale: "linear" },
  "m/s": { label: "m/s", scale: "linear" },
  ampere: { label: "Ampere", scale: "linear" },
  log10: { label: "Log10", scale: "log" }
}
```

---

### Colorscales

All [matplotlib colorscales](https://matplotlib.org/stable/gallery/color/colormap_reference.html) are registered by default when you import from `./src/index.js`. Reference them by name in `colorAxes` entries or `config.axes` overrides.

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
