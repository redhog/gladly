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

The auto-created widgets are [`Float`](#float) instances — draggable, resizable floating panels positioned inside the plot's container — wrapping a `Colorbar` or `Filterbar` as appropriate.

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

A draggable, resizable floating panel. `Float` is a generic container — it wraps any widget returned by a factory function.

```javascript
new Float(parentPlot, factory, { x, y, width, height })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `parentPlot` | Plot | — | The plot whose container the float is appended to. |
| `factory` | `(container: HTMLElement) => { destroy() }` | — | Called with the float's content element; must return an object with a `destroy()` method. |
| `x` | number | `10` | Initial left position within the container (px). |
| `y` | number | `10` | Initial top position within the container (px). |
| `width` | number | `220` | Initial width (px). |
| `height` | number | `82` | Initial height (px). |

**Behavior:**
- Appended as an `absolute`-positioned div inside `parentPlot.container`.
- A thin drag bar at the top allows repositioning; the content area below it receives all events normally.
- A resize handle at the bottom-right allows resizing.
- Call `destroy()` to remove the widget and call the inner widget's `destroy()`.

To create a floating colorbar manually, pass a `Colorbar` factory:

```javascript
import { Float, Colorbar } from './src/index.js'

const floatCb = new Float(
  plot,
  (container) => new Colorbar(container, plot, "temperature", { orientation: "horizontal" }),
  { x: 20, y: 20, width: 220, height: 82 }
)

// Later:
floatCb.destroy()
```

To create a floating filterbar manually, pass a `Filterbar` factory:

```javascript
import { Float, Filterbar } from './src/index.js'

const floatFb = new Float(
  plot,
  (container) => new Filterbar(container, plot, "depth", { orientation: "horizontal" }),
  { x: 20, y: 80, width: 220, height: 82 }
)

// Later:
floatFb.destroy()
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

For floating filterbars use `Float` with a `Filterbar` factory — see the [`Float`](#float) section above for an example.
