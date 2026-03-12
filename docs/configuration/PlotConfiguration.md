# Plot Configuration Format

This page documents the JSON configuration format for `plot.update()`. For the Plot API see [`Plot`](../user-api/Plot.md).

---

## config Structure

```javascript
plot.update({
  data: { /* data object */ },
  config: {
    layers: [ /* layer specifications */ ],
    axes: { /* axis configuration */ }
  }
})
```

---

## Layer Specification

Each entry in `config.layers` is an object with a single key (the registered layer type name) mapping to that layer's parameters:

```javascript
config: {
  layers: [
    { layerTypeName: { param1: value1, param2: value2 } }
  ]
}
```

The parameters accepted by each layer type are defined by its JSON Schema. See [Built-in Layer Types](../user-api/BuiltInLayerTypes.md) for the full parameter tables.

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

Omit an axis entirely to have its range auto-calculated from the data.

### Color Axes

The key is the **quantity kind** string declared by the layer type. Each entry accepts:

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Lower bound of the color range (auto-calculated if omitted) |
| `max` | number | Upper bound of the color range (auto-calculated if omitted) |
| `colorscale` | string | Named colorscale string (see [Colorscales](../user-api/Colorscales.md)) |
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
