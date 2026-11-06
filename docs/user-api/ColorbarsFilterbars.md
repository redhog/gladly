# Colorbars and Filterbars

Gladly provides interactive widgets for visualising and controlling color axes and filter axes.

---

## Auto-creation via config

The simplest way to show a colorbar or filterbar is to set `colorbar` or `filterbar` on a color or filter axis in `config.axes`:

```javascript
plot.update({
  data: { x, y, temperature, depth },
  config: {
    layers: [
      { points: { xData: "x", yData: "y", vData: "temperature" } }
    ],
    axes: {
      temperature: { colorbar: "horizontal" },  // floating colorbar
      depth:        { filterbar: "vertical"  }  // floating filterbar
    }
  }
})
```

Accepted values: `"horizontal"`, `"vertical"`, `"none"` (default). Calling `update()` again with a different value automatically destroys and recreates the widget.

The auto-created widgets are [`Float`](../user-api/Widgets.md#float) instances — draggable, resizable floating panels positioned inside the plot's container — wrapping a `Colorbar` or `Filterbar` as appropriate.

Zooming or panning a colorbar changes the color range; zooming a filterbar changes the filter bounds. To set either exactly, point at the bar's tick labels and click one of its two end values to [type it](../configuration/PlotConfiguration.md#typed-axis-limits).

---

For manual creation API, see [Widgets](../user-api/Widgets.md).
