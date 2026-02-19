# Built-in Layer Types

Gladly ships three pre-registered layer types. For writing custom layer types see [Writing Layer Types](LayerTypes.md).

---

## `scatter`

A scatter plot that renders points coloured by a per-point value mapped through a colorscale.

**Auto-registered** on import. `scatterLayerType` is also exported if you need the `LayerType` object directly (e.g. to inspect its schema).

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `xData` | yes | — | Data key for x coordinates; also used as the x-axis quantity kind |
| `yData` | yes | — | Data key for y coordinates; also used as the y-axis quantity kind |
| `vData` | yes | — | Data key for color values; also used as the color axis quantity kind |
| `xAxis` | no | `"xaxis_bottom"` | x-axis position |
| `yAxis` | no | `"yaxis_left"` | y-axis position |

**Behavior:**
- Point size: 4.0 px
- Spatial quantity kinds derived from `xData`/`yData` property names
- Color axis quantity kind derived from `vData` property name
- Colorscale: from `config.axes[vData].colorscale`, or the quantity kind registry; defaults to `"viridis"` if registered
- Supports log scales on all axes via `config.axes[...].scale: "log"`

**Example:**

```javascript
plot.update({
  data: { x, y, temperature },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      temperature: { min: 0, max: 100, colorscale: "plasma" }
    }
  }
})
```

---

## `colorbar`

A layer type that fills the entire plot canvas with a color gradient. Used internally by [`Colorbar`](ColorbarsAndFilterbars.md#colorbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `colorbarLayerType` is also exported if you need the `LayerType` object directly.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `colorAxis` | yes | — | Quantity kind of the color axis to display |
| `orientation` | no | `"horizontal"` | `"horizontal"` or `"vertical"` — direction the gradient runs |

**Behavior:**
- Renders a triangle-strip quad that fills the entire canvas with a color gradient
- Horizontal: gradient runs left → right; vertical: bottom → top
- The spatial axis of the plot (x for horizontal, y for vertical) is bound to the color axis quantity kind, so the axis tick labels show actual data values
- The color axis range and colorscale are sourced from the owning plot's color axis registry

**Typical use:** Create a standalone `Plot` with one `colorbar` layer, link its spatial axis to the color axis of a data plot. The [`Colorbar`](ColorbarsAndFilterbars.md#colorbar) class does exactly this.

---

## `filterbar`

A layer type that registers a filter axis for axis-display purposes without rendering any geometry. Used internally by [`Filterbar`](ColorbarsAndFilterbars.md#filterbar), but can also be used directly in custom plot setups.

**Auto-registered** on import. `filterbarLayerType` is also exported if you need the `LayerType` object directly.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `filterAxis` | yes | — | Quantity kind of the filter axis to display |
| `orientation` | no | `"horizontal"` | `"horizontal"` or `"vertical"` — which spatial axis to bind |

**Behavior:**
- Registers the named filter axis with the plot (so it is accessible via `plot.axes[name]` and can be linked via `linkAxes`)
- Renders no geometry (`vertexCount: 0`)
- Binds the spatial axis (x for horizontal, y for vertical) to the filter axis quantity kind, so tick labels show the filter range

The [`Filterbar`](ColorbarsAndFilterbars.md#filterbar) class wraps a plot using this layer type and adds interactive UI (∞ checkboxes for open bounds, zoom/pan to adjust the filter range).
