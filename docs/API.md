# Gladly API Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library that uses WebGL (via [regl](https://github.com/regl-project/regl)) for high-performance data rendering and [D3.js](https://d3js.org/) for interactive axes and zoom controls.

---

## Data Model

### LayerType

A **LayerType** defines how data is visualized. Each LayerType specifies:

- **X-axis and Y-axis units** - Each axis has a unit (e.g., "meters", "volts", "log10")
- **GLSL shaders** - Vertex and fragment shaders that define how data is rendered on the GPU
- **Data attributes** - Which fields from your data are passed to the shaders

### Layer

A **Layer** is an instance of a LayerType with specific data. Each layer has:

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

### Implementation in GLSL

LayerTypes are implemented as GLSL shaders that run on the GPU. The library automatically provides:
- **Uniforms**: `xDomain` (vec2), `yDomain` (vec2), `count` (int)
- **Attributes**: Your data arrays (x, y, v, etc.)

---

## Making a Plot

Here's a minimal example of creating a scatter plot:

```javascript
import { Plot, Layer, AxisRegistry, scatterLayerType } from './src/index.js'

// 1. Prepare data as Float32Arrays
const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

// 2. Create a layer with a LayerType (scatterLayerType)
const layer = new Layer({
  type: scatterLayerType,
  data: { x, y, v },
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left"
})

// 3. Set up the plot container
const canvas = document.getElementById("canvas")
const svg = document.getElementById("svg")
const plot = new Plot({ canvas, svg, width: 800, height: 600 })

// 4. Create axis registry and attach to plot
const axisRegistry = new AxisRegistry(800, 600)
plot.setAxisRegistry(axisRegistry)

// 5. Add layer and set axis domains
plot.addLayer(layer)
axisRegistry.getScale("xaxis_bottom").domain([0, 60])
axisRegistry.getScale("yaxis_left").domain([0, 50])

// 6. Render
plot.render()
```

**HTML Setup:**
```html
<canvas id="canvas" width="800" height="600"></canvas>
<svg id="svg" width="800" height="600" style="position: absolute; pointer-events: none;"></svg>
```

---

## Making a LayerType

To create a custom LayerType, define it with custom GLSL shaders:

```javascript
import { LayerType } from './src/index.js'

const redDotsType = new LayerType({
  name: "red_dots",
  xUnit: "meters",
  yUnit: "volts",

  // Vertex shader: transform data coordinates to screen space
  vert: `
    precision mediump float;
    attribute float x, y;
    uniform vec2 xDomain, yDomain;

    void main() {
      // Normalize to [-1, 1] for GPU
      float xNorm = (x - xDomain[0]) / (xDomain[1] - xDomain[0]) * 2.0 - 1.0;
      float yNorm = (y - yDomain[0]) / (yDomain[1] - yDomain[0]) * 2.0 - 1.0;

      gl_Position = vec4(xNorm, yNorm, 0, 1);
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
    x: (context, props) => props.data.x,
    y: (context, props) => props.data.y
  }
})

// Use the custom LayerType
const layer = new Layer({
  type: redDotsType,
  data: { x, y }
})
```

**Key Points:**
- **Units**: `xUnit` and `yUnit` must match one of: "meters", "volts", "log10"
- **Uniforms**: `xDomain` and `yDomain` are automatically provided by the library
- **Attributes**: Map to your data fields using accessor functions
- **Coordinate normalization**: Transform from data coordinates to GPU clip space [-1, 1]

---

## Installation

```bash
npm install regl d3
```

Then import Gladly components:

```javascript
import { Plot, Layer, LayerType, AxisRegistry, scatterLayerType } from './src/index.js'
```

---

## API Reference

### Plot

The main plotting container that manages WebGL rendering and SVG axes.

**Constructor:**
```javascript
new Plot({ canvas, svg, width, height })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `canvas` | HTMLCanvasElement | Canvas element for GPU rendering |
| `svg` | SVGElement | SVG element for rendering axes |
| `width` | number | Plot width in pixels |
| `height` | number | Plot height in pixels |

**Methods:**

| Method | Description |
|--------|-------------|
| `setAxisRegistry(axisRegistry)` | Associates an AxisRegistry with the plot |
| `addLayer(layer)` | Adds a data layer to the plot |
| `render()` | Renders all layers and axes |
| `renderAxes()` | Renders D3 axes on the SVG overlay |
| `initZoom()` | Sets up zoom interaction (all axes proportionally) |
| `setupAxisZoom(axisName)` | Sets up zoom for a specific axis |

---

### Layer

Represents a data layer to be visualized.

**Constructor:**
```javascript
new Layer({ type, data, xAxis, yAxis })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | LayerType | required | LayerType defining rendering behavior |
| `data` | object | required | Data object with Float32Array properties |
| `xAxis` | string | `"xaxis_bottom"` | Axis name for x-coordinate |
| `yAxis` | string | `"yaxis_left"` | Axis name for y-coordinate |

**Data Object:**
- Must contain `x` and `y` as Float32Array
- Can contain additional fields (e.g., `v` for values)
- All arrays must be same length
- All arrays must be Float32Array (validation enforced)

**Example:**
```javascript
const layer = new Layer({
  type: scatterLayerType,
  data: {
    x: new Float32Array([1, 2, 3]),
    y: new Float32Array([4, 5, 6]),
    v: new Float32Array([0.1, 0.5, 0.9])
  },
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left"
})
```

---

### LayerType

Defines how a layer is rendered using custom GLSL shaders.

**Constructor:**
```javascript
new LayerType({ name, xUnit, yUnit, vert, frag, attributes })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Type name (e.g., "scatter") |
| `xUnit` | string | Unit for x-axis: "meters", "volts", or "log10" |
| `yUnit` | string | Unit for y-axis: "meters", "volts", or "log10" |
| `vert` | string | GLSL vertex shader code |
| `frag` | string | GLSL fragment shader code |
| `attributes` | object | Map of attribute names to data accessors |

**Shader Uniforms (automatically provided):**
- `xDomain` (vec2): [min, max] of x-axis domain
- `yDomain` (vec2): [min, max] of y-axis domain
- `count` (int): Number of data points

**Attribute Accessor Format:**
```javascript
attributes: {
  x: (context, props) => props.data.x,
  y: (context, props) => props.data.y,
  v: (context, props) => props.data.v
}
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createDrawCommand(regl)` | Compiles shaders into a regl draw command |

---

### AxisRegistry

Manages D3 scales for multiple axes and enforces unit consistency.

**Constructor:**
```javascript
new AxisRegistry(width, height)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `width` | number | Canvas width in pixels |
| `height` | number | Canvas height in pixels |

**Methods:**

| Method | Description |
|--------|-------------|
| `ensureAxis(axisName, unit)` | Gets or creates a scale with unit validation |
| `getScale(axisName)` | Returns the D3 scale for an axis |

**Available Axes:**
- `"xaxis_bottom"` - Bottom x-axis
- `"xaxis_top"` - Top x-axis
- `"yaxis_left"` - Left y-axis
- `"yaxis_right"` - Right y-axis

**Available Units:**
- `"meters"` - Linear scale, label: "Meters"
- `"volts"` - Linear scale, label: "Volts"
- `"log10"` - Logarithmic scale, label: "Log10"

**Example:**
```javascript
const registry = new AxisRegistry(800, 600)
const xScale = registry.ensureAxis("xaxis_bottom", "meters")
xScale.domain([0, 100])
```

---

### scatterLayerType

A pre-configured LayerType for scatter plots.

**Configuration:**
- **Name:** "scatter"
- **Units:** "meters" (both x and y)
- **Attributes:** x, y, v (value for coloring)
- **Point Size:** 4.0 pixels
- **Color Map:** Red (v=0) → Blue (v=1) via `rgb(v, 0, 1-v)`

**Usage:**
```javascript
import { scatterLayerType } from './src/index.js'

const layer = new Layer({
  type: scatterLayerType,
  data: { x, y, v }
})
```

---

## Interaction

### Canvas Zoom

Zoom all axes proportionally using mouse wheel:
- **Trigger:** Mouse wheel/trackpad on canvas
- **Effect:** Scales all axis domains proportionally
- **Range:** 0.5x to 50x

### Axis-Specific Zoom

Zoom individual axes:
- **Trigger:** Mouse wheel/trackpad over SVG axis
- **Effect:** Scales only that axis domain
- **Range:** 0.5x to 50x

---

## Advanced Examples

### Custom Color Gradient

```javascript
const gradientType = new LayerType({
  name: "gradient",
  xUnit: "meters",
  yUnit: "meters",
  vert: `
    precision mediump float;
    attribute float x, y, v;
    varying float vValue;
    uniform vec2 xDomain, yDomain;

    void main() {
      float xNorm = (x - xDomain[0]) / (xDomain[1] - xDomain[0]) * 2.0 - 1.0;
      float yNorm = (y - yDomain[0]) / (yDomain[1] - yDomain[0]) * 2.0 - 1.0;
      gl_Position = vec4(xNorm, yNorm, 0, 1);
      gl_PointSize = 8.0;
      vValue = v;  // Pass to fragment shader
    }
  `,
  frag: `
    precision mediump float;
    varying float vValue;

    void main() {
      // Viridis-inspired gradient
      float r = vValue;
      float g = sqrt(vValue);
      float b = 1.0 - vValue;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
  attributes: {
    x: (context, props) => props.data.x,
    y: (context, props) => props.data.y,
    v: (context, props) => props.data.v
  }
})
```

### Multi-Axis Plot

```javascript
// Create two layers with different units on different axes
const tempLayer = new Layer({
  type: temperatureType,  // Uses "volts" unit
  data: { x: timeData, y: tempData },
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left"
})

const pressureLayer = new Layer({
  type: pressureType,  // Uses "log10" unit
  data: { x: timeData, y: pressureData },
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_right"  // Different y-axis
})

plot.addLayer(tempLayer)
plot.addLayer(pressureLayer)

// Configure both y-axes
axisRegistry.getScale("yaxis_left").domain([0, 100])
axisRegistry.getScale("yaxis_right").domain([0.1, 1000])  // Log scale
```

### Large Dataset

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

const layer = new Layer({
  type: scatterLayerType,
  data: { x, y, v }
})

// GPU handles rendering efficiently
plot.addLayer(layer)
plot.render()
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
    import { Plot, Layer, AxisRegistry, scatterLayerType } from './src/index.js'

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

    // Create layer
    const layer = new Layer({
      type: scatterLayerType,
      data: { x, y, v },
      xAxis: "xaxis_bottom",
      yAxis: "yaxis_left"
    })

    // Set up plot
    const canvas = document.getElementById("canvas")
    const svg = document.getElementById("svg")
    const plot = new Plot({ canvas, svg, width: 800, height: 600 })

    // Configure axes
    const axisRegistry = new AxisRegistry(800, 600)
    plot.setAxisRegistry(axisRegistry)
    plot.addLayer(layer)

    // Set domains
    axisRegistry.getScale("xaxis_bottom").domain([0, 100])
    axisRegistry.getScale("yaxis_left").domain([0, 50])

    // Render
    plot.render()
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
  log10: { label: "Log10", scale: "log" }
}
```
