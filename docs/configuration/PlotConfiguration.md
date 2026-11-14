# Configuring Plots

This page covers everything needed to create and configure plots. For writing custom layer types see [Writing Layer Types](../extension-api/LayerTypes.md). For an overview of the data model see the [main API doc](../user-api/overview.md).

---

## Basic Usage

```javascript
import { Plot } from './src/index.js'
import './src/PointsLayer.js'  // auto-registers "points" layer type

const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

const plot = new Plot(document.getElementById("plot-container"))

plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { points: { xData: "x", yData: "y", vData: "v" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },
      yaxis_left:   { min: 0, max: 50 }
    }
  }
})
```

---

## config Structure

```javascript
plot.update({
  data: { /* data object */ },
  config: {
    layers: [ /* layer specifications */ ],
    axes: { /* axis configuration */ },
    transforms: [ /* data transforms */ ],
    colorbars: [ /* colorbar overrides */ ]
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

The parameters accepted by each layer type are defined by its JSON Schema. See [Built-in Layer Types](BuiltInLayerTypes.md) for the full parameter tables. The built-in `points` type accepts at minimum:

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

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Lower bound of the axis range (auto-calculated if omitted) |
| `max` | number | Upper bound of the axis range (auto-calculated if omitted) |
| `scale` | string | `"linear"` (default) or `"log"` — logarithmic scale; all data values must be > 0 |
| `label` | string | Axis label text (overrides the quantity kind registry default) |
| `visible` | boolean | `false` hides the axis line, ticks, tick labels and title; the axis still sets the range of its layers. Its side then counts as having no axis for [`marginWithoutAxis`](../user-api/Plot.md#margins). Default `true` |
| `tickLabelsVisible` | boolean | `false` hides the numeric tick labels only (the line, ticks and title stay). Default `true` |
| `titleVisible` | boolean | `false` hides the axis title only (the line, ticks and tick labels stay). Default `true` |
| `locked` | boolean | `true` locks the axis range (see [Range lock](#range-lock)). Default `false` |

Omit an axis entirely to have its range auto-calculated from the data.

#### Axis-part visibility

`tickLabelsVisible` and `titleVisible` hide the tick labels or the title on their own, separately from hiding the whole axis with `visible: false`. The three switches are independent. In the schema these four booleans (`visible`, `tickLabelsVisible`, `titleVisible`, `locked`) are **required with defaults** (`true`/`true`/`true`/`false`), so a schema-driven editor always renders them rather than hiding an absent optional key. Hiding a part also **gives its margin band back**: a side that keeps its line and ticks but drops its title gets the title band back, dropping its tick labels gets the label band back, never going below [`marginWithoutAxis`](../user-api/Plot.md#margins) for that side. This works on 3D plots too for the drawing (3D margins do not change). All three keys round-trip through `plot.getConfig()` and are restored by `plot.update()`.

#### Range lock

`locked: true` pins an axis's range so it survives zoom, scroll and pan on any plot, and survives `plot.resetAxes()`, until switched off. The lock:

- is **local to one plot** — it never propagates across `linkAxes` and never consults another plot. The only grouping it honours is within the same plot: slots that share a quantity kind are one axis and share one lock.
- **blocks gestures only.** A locked axis ignores wheel, drag and touch (its free neighbours in the same gesture still move). It does **not** block deliberate changes: a [typed limit](#typed-axis-limits), a programmatic `axis.setDomain()`, and a domain pushed from a linked plot all still move it (a link push is, by design, a programmatic update).
- shows two cues: the **axis line is drawn red**, and a small **lock glyph** sits beside the title (the glyph is hidden when the title or the whole axis is hidden; the red line still shows).

Toggle it from code with [`plot.setAxisLocked(slot, on)`](../user-api/Plot.md#setaxislockedslot-on) / read it with [`plot.isAxisLocked(slot)`](../user-api/Plot.md#isaxislockedslot), or directly: **clicking an axis title toggles that axis's lock** (2D and 3D). A drag that starts on the title pans/rotates instead; the toggle fires only on a click that does not move. The `locked` key round-trips through `plot.getConfig()`.

### Color Axes

The key is the **quantity kind** string declared by the layer type. Each entry accepts:

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Lower bound of the color range (auto-calculated if omitted) |
| `max` | number | Upper bound of the color range (auto-calculated if omitted) |
| `colorscale` | string | Named colorscale string (see [Colorscales](Colorscales.md)) |
| `scale` | string | `"linear"` (default) or `"log"` — logarithmic mapping; range values must be > 0 |
| `label` | string | Axis label text (overrides the quantity kind registry default) |
| `colorbar` | string | `"none"` (default), `"horizontal"`, or `"vertical"` — auto-creates a floating colorbar widget |

Multiple layers sharing the same quantity kind automatically share a common range and colorscale.

### Filter Axes

The key is the **quantity kind** string declared by the layer type. Each entry accepts:

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Lower bound — points with value < min are discarded |
| `max` | number | Upper bound — points with value > max are discarded |
| `scale` | string | `"linear"` (default) or `"log"` — logarithmic scale for the filterbar display; data values must be > 0 |
| `label` | string | Axis label text (overrides the quantity kind registry default) |
| `filterbar` | string | `"none"` (default), `"horizontal"`, or `"vertical"` — auto-creates a floating filterbar widget |

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

For manual widget placement in a separate container, see [ColorbarsFilterbars](../user-api/ColorbarsFilterbars.md).

---

## Transforms

The `config.transforms` array applies data transformations before layers render. Each transform computes new data from existing data and auto-creates filter axes for any quantities it filters on.

```javascript
config: {
  transforms: [
    {
      name: "histogram",
      transform: {
        HistogramData: {
          input: "temperature",
          bins: 50,
          filter: "depth"
        }
      }
    }
  ]
}
```

Each entry is an object with:
- `name`: key to access the transformed data (e.g., `data.histogram.counts`)
- `transform`: object with a single key — the computation class name (e.g., `HistogramData`, `FftData`, `ElementwiseData`) — and its parameters as the value

See [Computations](Computations.md) for the full list of available transforms and their parameters.

Transforms auto-create filter axes for any `filter` parameter. Configure these in `config.axes` just like any other filter axis.

---

## Colorbars

The `config.colorbars` array creates floating colorbar widgets and overrides colorscale settings for specific axes. This is useful for explicitly controlling colorscales outside of the axis configuration.

### 1D Colorbars

Specify a single axis to create a 1D colorbar:

```javascript
config: {
  colorbars: [
    { xAxis: "temperature", colorscale: "viridis" },
    { yAxis: "pressure", colorscale: "plasma" }
  ]
}
```

### 2D Colorbars

Specify both `xAxis` and `yAxis` with a 2D colorscale to create a 2D (bivariate) colorbar:

```javascript
config: {
  colorbars: [
    { xAxis: "temperature", yAxis: "humidity", colorscale: "coolwarm" }
  ]
}
```

2D colorscales map a 2D position to a color and are useful for visualizing relationships between two quantities. Available 2D colorscales include `"coolwarm"`, `"BuPu"`, and others registered as bivariate colorscales.

Each entry accepts:

| Property | Type | Description |
|----------|------|-------------|
| `xAxis` | string | Quantity kind for the x-axis color scale (required for 2D, optional for 1D) |
| `yAxis` | string | Quantity kind for the y-axis color scale (required for 2D, optional for 1D) |
| `colorscale` | string | Named colorscale string (1D or 2D). Use `"none"` to hide the colorbar. See [Colorscales](Colorscales.md) |
| `enabled` | boolean | Default `true`. When `false`, the entry does **not** override its member axes' colorscales — each axis reverts to its own colorscale (so a 2D pairing stops forcing the bivariate colouring). An entry with `enabled: false` is the same state as having no entry at all. |
| `colorbar` | boolean | Default `true`. When `false`, the floating colorbar widget for this entry is not drawn. The two booleans are independent: `enabled: true, colorbar: false` gives 2D colouring with no visible bar. |

Top-level colorbar entries override colorscales set in `config.axes` or the quantity kind registry.

Both booleans apply identically to 1D and 2D entries, and both round-trip through `plot.getConfig()`. For 2D entries you can also drive them through the first-class [`Axis2d`](../user-api/Axis2d.md) handle (`plot.axis2d[...]`).

---

## Auto Range Calculation

If you omit an axis from `config.axes`, its range is automatically calculated from the data of all layers that use it:

```javascript
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { points: { xData: "x", yData: "y", vData: "v" } }
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
      { points: { xData: "x1", yData: "y1", vData: "v1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
      { points: { xData: "x2", yData: "y2", vData: "v2", xAxis: "xaxis_top",    yAxis: "yaxis_right" } }
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

## Zoom and Pan

Gladly supports interactive zoom and pan out of the box:

- **Plot area:** mouse wheel zooms all axes; drag pans all axes
- **Axis-specific:** mouse wheel or drag over an individual axis affects only that axis
- **Zoom extent:** 0.5× to 50×
- **Cursor-anchored:** the data point under the mouse cursor stays fixed during zoom

A zoomed or panned range is written into `axes` (as `min` and `max`) and is returned by `getConfig()`.

While `update()` is still building a plot, wheel, drag, touch and axis-limit input on that plot is ignored, since its axes do not have their ranges yet. A range that a linked axis sets on it meanwhile is kept when the update finishes.

---

## Typed Axis Limits

The ends of every spatial axis can be typed exactly, which is quicker than zooming to a round number. This works in both 2D and 3D:

- **Open:** double-click an axis band (the margin beside the axis). One text field opens, at the end nearest the click, holding that end's current value.
- **Type:** type a number. E-notation works (`1e-4`).
- **Keys:** Enter sets the value and closes, Tab sets it and moves to the other end, and Escape cancels. Clicking elsewhere sets a valid value and drops an invalid one.
- **Which end:** the end nearest the click. The bottom or left end is the axis's `min` (the domain's first value), the top or right end its `max`; which the field edits is decided by the click's position along the axis, so it stays right on reversed and log axes.

A typed value is refused, with the reason in the field's tooltip, if it is not a number, if it equals the other end (which would collapse the axis to zero width), or if it is zero or below on a log axis. Crossing the other end is allowed — that reverses the axis, which gladly supports (a domain like `{ min: 10, max: 1 }` just renders from 10 down to 1).

The value is set through `Axis.setDomain()`, the same path zoom and pan take, so it lands in `axes` like a zoomed range, and linked axes follow. Colorbar and filterbar floats are plots of their own, so their ends can be typed too, and that sets the color range or filter bounds of the plot they belong to. Each typed value fires an [`"axislimit"`](../user-api/Plot.md#synthetic-plot-events) event on the plot. In 3D, only the front-facing axes are clickable (the same ones pan responds to); starting a rotation dismisses an open field.

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

const plot = new Plot(document.getElementById("plot-container"))
plot.update({
  data: { x, y, v },
  config: {
    layers: [{ points: { xData: "x", yData: "y", vData: "v" } }]
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
    import { Plot } from './src/index.js'
    import './src/PointsLayer.js'  // auto-registers "points" layer type

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
          { points: { xData: "x", yData: "y", vData: "v" } }
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
