# Configuring Plots

This page covers everything needed to create and configure plots. For writing custom layer types see [Writing Layer Types](LayerTypes.md). For an overview of the data model see the [main API doc](../API.md).

---

## Basic Usage

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

registerLayerType("scatter", scatterLayerType)

const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

const plot = new Plot(document.getElementById("plot-container"))

plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },
      yaxis_left:   { min: 0, max: 50 }
    }
  }
})
```

---

## Layer Specification Format

Each entry in `config.layers` is an object with a single key (the registered layer type name) mapping to that layer's parameters:

```javascript
config: {
  layers: [
    { layerTypeName: { param1: value1, param2: value2 } }
  ]
}
```

The parameters accepted by each layer type are defined by its JSON Schema. The built-in `scatter` type accepts:

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `xData` | yes | — | Key in `data` for x coordinates |
| `yData` | yes | — | Key in `data` for y coordinates |
| `vData` | yes | — | Key in `data` for color values |
| `xAxis` | no | `"xaxis_bottom"` | Which x-axis to use |
| `yAxis` | no | `"yaxis_left"` | Which y-axis to use |

---

## Axes Configuration

The `config.axes` object controls ranges and colorscales. All entries are optional.

```javascript
config: {
  axes: {
    // Spatial axes
    xaxis_bottom: { min: 0, max: 100 },
    xaxis_top:    { min: 0, max: 100 },
    yaxis_left:   { min: 0, max: 50 },
    yaxis_right:  { min: 0, max: 50 },

    // Color axes — key is the quantity kind declared by the layer
    temperature: { min: 20, max: 80, colorscale: "plasma" },

    // Filter axes — both bounds are optional (open interval)
    depth: { min: 10, max: 500 },   // closed range
    time:  { min: 0 },              // open upper bound
    z:     { max: 1000 }            // open lower bound
  }
}
```

### Spatial Axes

Four positions are available:

| Name | Position |
|------|----------|
| `xaxis_bottom` | Bottom |
| `xaxis_top` | Top |
| `yaxis_left` | Left |
| `yaxis_right` | Right |

Each accepts:

| Property | Description |
|----------|-------------|
| `min` | Lower bound of the axis range (auto-calculated if omitted) |
| `max` | Upper bound of the axis range (auto-calculated if omitted) |
| `scale` | `"linear"` (default) or `"log"` — logarithmic scale; all data values must be > 0 |
| `label` | Axis label text (overrides the quantity kind registry default) |

Omit an axis entirely to have its range auto-calculated from the data.

### Color Axes

The key is the **quantity kind** string declared by the layer type (for the built-in scatter type this is the value of `vData`, e.g. `"v"`). Each entry accepts:

| Property | Description |
|----------|-------------|
| `min` | Lower bound of the color range (auto-calculated if omitted) |
| `max` | Upper bound of the color range (auto-calculated if omitted) |
| `colorscale` | Named colorscale string (see [colorscales reference](LayerTypes.md#colorscales)) |
| `scale` | `"linear"` (default) or `"log"` — logarithmic mapping; range values must be > 0 |
| `label` | Axis label text (overrides the quantity kind registry default) |
| `colorbar` | `"none"` (default), `"horizontal"`, or `"vertical"` — auto-creates a floating colorbar widget |

Multiple layers sharing the same quantity kind automatically share a common range and colorscale.

### Filter Axes

The key is the **quantity kind** string declared by the layer type. Each entry accepts:

| Property | Description |
|----------|-------------|
| `min` | Lower bound — points with value < min are discarded |
| `max` | Upper bound — points with value > max are discarded |
| `scale` | `"linear"` (default) or `"log"` — logarithmic scale for the filterbar display; data values must be > 0 |
| `label` | Axis label text (overrides the quantity kind registry default) |
| `filterbar` | `"none"` (default), `"horizontal"`, or `"vertical"` — auto-creates a floating filterbar widget |

Both `min` and `max` are independently optional. Omitting both (or not listing the filter axis at all) means no filtering: all points are shown.

### Floating Widgets (colorbar / filterbar)

Setting `colorbar` or `filterbar` on an axis auto-creates a floating, draggable, resizable widget inside the plot container:

```javascript
axes: {
  temperature: {
    colorscale: "plasma",
    colorbar: "horizontal"   // floating colorbar below the plot area
  },
  depth: {
    filterbar: "vertical"    // floating filterbar on the side
  }
}
```

The widget is destroyed and recreated whenever `update()` is called with a changed value. Setting the property back to `"none"` removes it.

For manual widget placement in a separate container, see [Colorbars and Filterbars](ColorbarsAndFilterbars.md).

---

## Auto Range Calculation

If you omit an axis from `config.axes`, its range is automatically calculated from the data of all layers that use it:

```javascript
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ]
    // No axes — ranges auto-calculated from data
  }
})
```

---

## Multi-Layer Plot

Multiple layers can share axes or use independent axes:

```javascript
plot.update({
  data: { x1, y1, v1, x2, y2, v2 },
  config: {
    layers: [
      { scatter: { xData: "x1", yData: "y1", vData: "v1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
      { scatter: { xData: "x2", yData: "y2", vData: "v2", xAxis: "xaxis_top",    yAxis: "yaxis_right" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 10 },
      yaxis_left:   { min: 0, max: 5 }
      // xaxis_top and yaxis_right auto-calculated
    }
  }
})
```

---

## Interaction

### Zoom and Pan

Gladly supports interactive zoom and pan out of the box:

- **Plot area:** mouse wheel zooms all axes; drag pans all axes
- **Axis-specific:** mouse wheel or drag over an individual axis affects only that axis
- **Zoom extent:** 0.5× to 50×
- **Cursor-anchored:** the data point under the mouse cursor stays fixed during zoom

---

## Advanced Examples

### Multi-Axis Plot with Different Units

```javascript
import { Plot, LayerType, registerLayerType } from './src/index.js'

const tempType = new LayerType({
  name: "temperature",
  xAxisQuantityKind: "time_s",
  yAxisQuantityKind: "temperature_K",
  getAxisConfig: (params) => ({ xAxis: params.xAxis, yAxis: params.yAxis }),
  // ... vert, frag, schema, createLayer
})

const pressureType = new LayerType({
  name: "pressure",
  xAxisQuantityKind: "time_s",
  yAxisQuantityKind: "pressure_Pa",
  getAxisConfig: (params) => ({ xAxis: params.xAxis, yAxis: params.yAxis }),
  // ... vert, frag, schema, createLayer
})

registerLayerType("temperature", tempType)
registerLayerType("pressure", pressureType)

const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { time, temp, pressure },
  config: {
    layers: [
      { temperature: { xData: "time", yData: "temp",     xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
      { pressure:    { xData: "time", yData: "pressure", xAxis: "xaxis_bottom", yAxis: "yaxis_right" } }
    ],
    axes: {
      xaxis_bottom: { min: 0,   max: 100 },
      yaxis_left:   { min: 0,   max: 100 },
      yaxis_right:  { min: 0.1, max: 1000, scale: "log" }
    }
  }
})
```

### Large Dataset (100 k points)

```javascript
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
    layers: [{ scatter: { xData: "x", yData: "y", vData: "v" } }]
    // Ranges auto-calculated from data
  }
})
// GPU renders 100k points efficiently at 60fps
```

---

## Complete Working Example

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; }
    #plot-container { position: relative; width: 800px; height: 600px; }
  </style>
</head>
<body>
  <div id="plot-container"></div>

  <script type="module">
    import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

    registerLayerType("scatter", scatterLayerType)

    const N = 5000
    const x = new Float32Array(N)
    const y = new Float32Array(N)
    const v = new Float32Array(N)

    for (let i = 0; i < N; i++) {
      x[i] = Math.random() * 100
      y[i] = Math.random() * 50
      v[i] = Math.random()
    }

    const plot = new Plot(document.getElementById("plot-container"))
    plot.update({
      data: { x, y, v },
      config: {
        layers: [
          { scatter: { xData: "x", yData: "y", vData: "v" } }
        ],
        axes: {
          xaxis_bottom: { min: 0, max: 100 },
          yaxis_left:   { min: 0, max: 50 }
        }
      }
    })
  </script>
</body>
</html>
```
