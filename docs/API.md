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

- **X-axis and Y-axis quantity units** - Each axis has a quantity unit (e.g., "meters", "volts", "log10")
- **GLSL shaders** - Vertex and fragment shaders that define how data is rendered on the GPU
- **Data attributes** - Which fields from your data are passed to the shaders
- **Schema** - JSON Schema definition for layer parameters
- **Factory method** - How to create a layer from parameters and data

### Layer

A **Layer** is an instance of a LayerType with specific data. Layers are created automatically by the Plot constructor from your declarative configuration.

Each layer has:
- **A LayerType** - Which defines how to render the data
- **Data** - Type-specific data in typed arrays (always `Float32Array`)
- **Axis assignment** - Which axes to use (e.g., "xaxis_bottom", "yaxis_left")

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

To create a custom LayerType, define it with custom GLSL shaders, a schema, and a factory method:

```javascript
import { LayerType, Layer } from './src/index.js'
import { AXES } from './src/index.js'

const redDotsType = new LayerType({
  name: "red_dots",
  xAxisQuantityUnit: "meters",
  yAxisQuantityUnit: "volts",

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

  // Fragment shader: define color
  frag: `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);  // Red
    }
  `,

  // Map data fields to shader attributes
  attributes: {
    x: { buffer: (context, props) => props.data.x },
    y: { buffer: (context, props) => props.data.y }
  },

  // JSON Schema for layer parameters
  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string", description: "Property name for x coordinates" },
      yData: { type: "string", description: "Property name for y coordinates" },
      xAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("x")),
        default: "xaxis_bottom"
      },
      yAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("y")),
        default: "yaxis_left"
      }
    },
    required: ["xData", "yData"]
  }),

  // Factory method to create layers from parameters and data
  createLayer: function(parameters, data) {
    const { xData, yData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters

    return new Layer({
      type: this,
      attributes: {
        x: data[xData],
        y: data[yData]
      },
      uniforms: {},
      xAxis,
      yAxis
    })
  }
})

// Register the layer type
import { registerLayerType } from './src/index.js'
registerLayerType("red_dots", redDotsType)
```

**Key Points:**
- **Quantity Units**: `xAxisQuantityUnit` and `yAxisQuantityUnit` must match one of: "meters", "volts", "m/s", "ampere", "log10"
- **Uniforms**: `xDomain` and `yDomain` are automatically provided by the library
- **Attributes**: Map to your data fields using accessor functions
- **Schema**: Returns a JSON Schema (Draft 2020-12) defining expected parameters
- **createLayer**: Extracts data from the data object and creates a Layer instance

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
| `config.axes` | object | Optional domain overrides for axes (see below) |
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
    xaxis_bottom: { min: 0, max: 100 },
    xaxis_top: { min: 0, max: 100 },
    yaxis_left: { min: 0, max: 50 },
    yaxis_right: { min: 0, max: 50 }
  }
}
```

Omitted axes will have domains auto-calculated from data.

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
new Layer({ type, attributes, uniforms, xAxis, yAxis })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | LayerType | required | LayerType defining rendering behavior |
| `attributes` | object | required | GPU attributes object with Float32Array properties |
| `uniforms` | object | required | GPU uniforms object with scalars/arrays |
| `xAxis` | string | `"xaxis_bottom"` | Axis name for x-coordinate |
| `yAxis` | string | `"yaxis_left"` | Axis name for y-coordinate |

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
new LayerType({ name, xAxisQuantityUnit, yAxisQuantityUnit, vert, frag, schema, createLayer })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Type name (e.g., "scatter") |
| `xAxisQuantityUnit` | string | Quantity unit for x-axis |
| `yAxisQuantityUnit` | string | Quantity unit for y-axis |
| `vert` | string | GLSL vertex shader code |
| `frag` | string | GLSL fragment shader code |
| `schema` | function | Function returning JSON Schema for parameters |
| `createLayer` | function | Function to create Layer from parameters and data |

**Note:** Attributes and uniforms are now defined dynamically by the Layer instance created by `createLayer`, not statically in LayerType. The `createDrawCommand` method inspects the layer's `attributes` and `uniforms` objects to build the WebGL configuration.

**Shader Uniforms (automatically provided):**
- `xDomain` (vec2): [min, max] of x-axis domain
- `yDomain` (vec2): [min, max] of y-axis domain
- `count` (int): Number of data points

**Attribute Accessor Format:**
```javascript
attributes: {
  x: { buffer: (context, props) => props.data.x },
  y: { buffer: (context, props) => props.data.y },
  v: { buffer: (context, props) => props.data.v }
}
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl)` | Compiles shaders into a regl draw command |
| `schema()` | Returns JSON Schema (Draft 2020-12) for layer parameters |
| `createLayer(parameters, data)` | Creates a Layer instance from parameters and data object |

---

### scatterLayerType

A pre-configured LayerType for scatter plots.

**Configuration:**
- **Name:** "scatter"
- **Units:** "meters" (both x and y)
- **Attributes:** x, y, v (value for coloring)
- **Point Size:** 4.0 pixels
- **Color Map:** Blue (v=0) → Red (v=1) via `rgb(v, 0, 1-v)`

**Parameters Schema:**
- `xData` (required): Property name in data object for x coordinates
- `yData` (required): Property name in data object for y coordinates
- `vData` (required): Property name in data object for color values
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
  xAxisQuantityUnit: "meters",
  yAxisQuantityUnit: "volts",
  // ... shaders and attributes
  schema: () => ({ /* ... */ }),
  createLayer: function(params, data) { /* ... */ }
})

const pressureType = new LayerType({
  name: "pressure",
  xAxisQuantityUnit: "meters",
  yAxisQuantityUnit: "log10",
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
