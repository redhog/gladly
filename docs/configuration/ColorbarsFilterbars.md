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
      { scatter: { xData: "x", yData: "y", vData: "temperature" } }
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

---

For manual creation API, see [Widgets](../user-api/Widgets.md).
