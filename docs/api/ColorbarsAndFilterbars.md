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

The auto-created widgets are instances of [`Float`](#float) (colorbar) and [`FilterbarFloat`](#filterbarfloat) (filterbar) — draggable, resizable floating panels positioned inside the plot's container.

---

## Manual creation

For custom layouts — separate containers, fixed sizing, or embedding in your own UI — create the widgets directly.

---

## `Colorbar`

A specialised plot that renders a color gradient and keeps itself in sync with a target plot's color axis. Extends `Plot`.

```javascript
new Colorbar(container, targetPlot, colorAxisName, { orientation, margin })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `container` | HTMLElement | — | Element to render into. Must have explicit CSS dimensions. |
| `targetPlot` | Plot | — | The plot whose color axis this colorbar tracks. |
| `colorAxisName` | string | — | Quantity kind of the color axis to display. |
| `orientation` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Direction of the gradient. |
| `margin` | object | orientation-specific | Margin `{ top, right, bottom, left }` in px. |

**Default margins:**
- Horizontal: `{ top: 5, right: 40, bottom: 45, left: 40 }`
- Vertical: `{ top: 40, right: 10, bottom: 40, left: 50 }`

**Behavior:**
- Automatically re-renders whenever `targetPlot` renders.
- Bidirectionally links its spatial axis to the target's color axis: zooming the colorbar updates the color range on the main plot and vice versa.
- Inherits all `Plot` methods. Call `destroy()` to clean up both the link and the render callback.

```javascript
import { Colorbar } from './src/index.js'

const cb = new Colorbar(
  document.getElementById("colorbar-container"),
  plot,
  "temperature",
  { orientation: "vertical" }
)

// Later:
cb.destroy()
```

---

## `Float`

A draggable, resizable floating panel that wraps a [`Colorbar`](#colorbar) inside the parent plot's container.

```javascript
new Float(parentPlot, colorAxisName, { orientation, x, y, width, height, margin })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `parentPlot` | Plot | — | The plot to attach the float to and to track the color axis from. |
| `colorAxisName` | string | — | Quantity kind of the color axis to display. |
| `orientation` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Gradient direction. |
| `x` | number | `10` | Initial left position within the container (px). |
| `y` | number | `10` | Initial top position within the container (px). |
| `width` | number | orientation-specific | Initial width (px). |
| `height` | number | orientation-specific | Initial height (px). |
| `margin` | object | — | Passed through to the internal `Colorbar`. |

**Default sizes:**
- Horizontal: 220 × 82 px (includes 12 px drag bar)
- Vertical: 70 × 232 px (includes 12 px drag bar)

**Behavior:**
- Appended as an `absolute`-positioned div inside `parentPlot.container`.
- A thin drag bar at the top allows repositioning; the colorbar below it receives zoom/pan events normally.
- A resize handle at the bottom-right allows resizing.
- Call `destroy()` to remove the widget and clean up the internal `Colorbar`.

```javascript
import { Float } from './src/index.js'

const floatCb = new Float(plot, "temperature", {
  orientation: "horizontal",
  x: 20,
  y: 20
})

// Later:
floatCb.destroy()
```

---

## `Filterbar`

A specialised plot that displays a filter axis range and lets the user adjust it interactively. Extends `Plot`.

```javascript
new Filterbar(container, targetPlot, filterAxisName, { orientation, margin })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `container` | HTMLElement | — | Element to render into. Must have explicit CSS dimensions. |
| `targetPlot` | Plot | — | The plot whose filter axis this filterbar controls. |
| `filterAxisName` | string | — | Quantity kind of the filter axis to control. |
| `orientation` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Layout direction. |
| `margin` | object | orientation-specific | Margin `{ top, right, bottom, left }` in px. |

**Default margins:**
- Horizontal: `{ top: 5, right: 40, bottom: 45, left: 40 }`
- Vertical: `{ top: 30, right: 10, bottom: 30, left: 50 }`

**Behavior:**
- Automatically re-renders whenever `targetPlot` renders.
- Bidirectionally links its spatial axis to the target's filter axis: zoom/pan on the filterbar updates the filter range applied to data.
- Shows ∞ checkboxes at each end to toggle open bounds (no minimum / no maximum filter).
- Inherits all `Plot` methods. Call `destroy()` to clean up.

```javascript
import { Filterbar } from './src/index.js'

const fb = new Filterbar(
  document.getElementById("filterbar-container"),
  plot,
  "depth",
  { orientation: "horizontal" }
)

// Later:
fb.destroy()
```

---

## `FilterbarFloat`

A draggable, resizable floating panel that wraps a [`Filterbar`](#filterbar) inside the parent plot's container.

```javascript
new FilterbarFloat(parentPlot, filterAxisName, { orientation, x, y, width, height, margin })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `parentPlot` | Plot | — | The plot to attach the float to and to track the filter axis from. |
| `filterAxisName` | string | — | Quantity kind of the filter axis to control. |
| `orientation` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Layout direction. |
| `x` | number | `10` | Initial left position within the container (px). |
| `y` | number | `100` | Initial top position within the container (px). |
| `width` | number | orientation-specific | Initial width (px). |
| `height` | number | orientation-specific | Initial height (px). |
| `margin` | object | — | Passed through to the internal `Filterbar`. |

**Default sizes:**
- Horizontal: 220 × 82 px (includes 12 px drag bar)
- Vertical: 80 × 232 px (includes 12 px drag bar)

**Behavior:**
- Appended as an `absolute`-positioned div inside `parentPlot.container`.
- Drag bar at the top for repositioning; filterbar below it receives events normally.
- Resize handle at the bottom-right for resizing.
- Call `destroy()` to remove the widget and clean up the internal `Filterbar`.

```javascript
import { FilterbarFloat } from './src/index.js'

const floatFb = new FilterbarFloat(plot, "depth", {
  orientation: "horizontal",
  x: 20,
  y: 80
})

// Later:
floatFb.destroy()
```
