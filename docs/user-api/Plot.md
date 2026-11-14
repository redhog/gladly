# Plot

The main plotting container that manages WebGL rendering and SVG axes.

---

## Constructor

```javascript
new Plot(container, { margin, marginWithoutAxis } = {})
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Parent `<div>`. Must have explicit CSS dimensions. Canvas and SVG are created inside it automatically. |
| `margin` | object | Plot margin in px: `{ top, right, bottom, left }`. Defaults to `{ top: 60, right: 60, bottom: 60, left: 60 }`. |
| `marginWithoutAxis` | object | Margin in px for a side that draws no axis: any of `{ top, right, bottom, left }`. A side left out uses `margin`. Defaults to `{}`, so every side uses `margin`. See [Margins](#margins). |

### Margins

An axis draws its tick marks, tick labels and title in three bands at **fixed pixel distances** outward from the axis line (not fractions of the margin): a tick band, the tick-label band, then the title band at the outer edge. The band sizes are read from the label atlas, so they stay correct at any font size. A side drawing all three parts needs the full `margin`. A side with no axis only needs room for the end labels of the axes beside it, which reach past the corners of the plot area. `marginWithoutAxis` sets that smaller room, so a plot that draws only a bottom and a left axis does not keep a full axis margin of empty space above and to the right of its data:

```javascript
const plot = new Plot(container, {
  margin:            { top: 48, right: 80, bottom: 48, left: 80 },
  marginWithoutAxis: { top: 12, right: 24, bottom: 12, left: 24 },
})
```

A side counts as drawing an axis when a layer uses that axis and the axis is not hidden with `visible: false` in `config.axes`. **Hiding a single part gives its band back too**: with `titleVisible: false` the side loses its title band, with `tickLabelsVisible: false` it loses its label band — never dropping below `marginWithoutAxis` for that side (see [Axis-part visibility](../configuration/PlotConfiguration.md#axis-part-visibility)). This is decided again at every `update()`, so moving a layer to `yaxis_right`, or hiding an axis or one of its parts, changes the margins with it. A 3D plot uses `margin` on every side.

---

## Instance properties

### `plot.axes`

A proxy object that returns a stable [`Axis`](Axis.md) instance for any axis name:

```javascript
plot.axes.xaxis_bottom   // spatial axis
plot.axes.xaxis_top
plot.axes.yaxis_left
plot.axes.yaxis_right
plot.axes["velocity_ms"] // color or filter axis, keyed by quantity kind
```

The same `Axis` instance is returned on every access, including across `plot.update()` calls. This makes it safe to pass axis references to `linkAxes()` before or after `update()`.

### `plot.margin`

The margin in use, in px: `{ top, right, bottom, left }`. It is `margin` from the constructor, with `marginWithoutAxis` applied to each side that drew no axis at the last `update()`. Read it to place your own elements around the plot area; writing it has no lasting effect, since the next `update()` sets it again.

---

## Instance methods

### `update({ config, data })`

Updates the plot with new configuration and/or data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | `{ layers, axes }` — see [Configuring Plots](../configuration/PlotConfiguration.md) |
| `config.layers` | array | Layer specifications: `[{ typeName: params }, ...]` |
| `config.axes` | object | Range overrides for spatial, color, and filter axes |
| `data` | object | Any plain object that `normalizeData()` can convert to a `DataGroup` tree (see [Data Format](Data.md)) |

**Behaviour:**
- Config-only: stores config, waits for data before rendering
- Data-only: updates data, re-renders with existing config
- Both: updates and renders
- Neither: re-renders (equivalent to `forceUpdate()`)

On a 3D plot the orbit orientation (the camera's azimuth, elevation and radius) is preserved across `update()`, so changing an unrelated setting — an axis option from the menu, say — does not snap the view back to its default angle.

### `forceUpdate()`

Re-renders with existing config and data.

### `getConfig()`

Returns a snapshot of the current configuration, enriched with live axis state.

```javascript
const config = plot.getConfig()
// config has the same shape as the object passed to update({ config })
```

The returned object is a shallow copy of the last config passed to `update()`, with the `axes` property replaced by a merged version that includes the current `min`/`max` for every active axis:

- **Spatial axes** (`xaxis_bottom`, etc.): `min`/`max` reflect the current zoom domain.
- **Color axes**: `min`/`max` reflect the current color range.
- **Filter axes**: `min`/`max` reflect the current filter bounds (either bound may be `null` for open ranges).

The result can be passed back to `update({ config })` to restore the exact current view, or serialised for state-saving / cross-plot synchronisation. The axis-part keys `visible`, `tickLabelsVisible`, `titleVisible` and `locked` round-trip through it as well (see [PlotConfiguration](../configuration/PlotConfiguration.md#axis-part-visibility)).

### `resetAxes()`

Resets the 2D spatial axes to their data range (via `axis.setDomain(null)` on each). Color and filter axes are left alone, and **locked axes are skipped**. On a 3D plot it does nothing (reset is 2D-only). A reversed axis stays reversed and a log axis stays above zero.

### `isAxisLocked(slot)`

Returns `true` when `slot` holds the range lock, or when another slot **of this same plot** with the same quantity kind holds it (slots that share a quantity kind are one axis to the user, so they share one lock). It does **not** follow `linkAxes` — the lock is local to one plot and never consults another.

### `setAxisLocked(slot, on)`

Turns the range lock on or off. Writes the `locked` key into `axes.<slot>` — setting it on the slot when turning on, clearing it on the slot and every same-quantity-kind sibling of this plot when turning off — then **re-renders without `update()`** (no layer rebuild). It touches only this plot's config, so the change round-trips through `getConfig()` with no extra work.

A locked axis ignores zoom, pan and scroll gestures (on any plot, 2D or 3D), and `resetAxes()` skips it, until the lock is switched off. It does **not** block deliberate changes: a typed limit, a programmatic `setDomain()`, and a domain pushed from a linked plot all still move it. See [Range lock](../configuration/PlotConfiguration.md#range-lock).

### `lookup(x, y)`

Converts container-relative pixel coordinates to data coordinates for all active spatial axes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `x` | number | Pixels from the left edge of the container |
| `y` | number | Pixels from the top edge of the container |

Returns a plain object keyed by axis name and quantity kind:

```javascript
const coords = plot.lookup(150, 200)
// { xaxis_bottom: 42.3, distance_m: 42.3, yaxis_left: 1.7, voltage_V: 1.7 }
```

Each active axis contributes two keys — the axis name (e.g. `"xaxis_bottom"`) and its quantity kind (e.g. `"distance_m"`), both mapping to the same value. Axes that have no scale (not yet initialised, or not used by any layer) are omitted.

---

### `on(eventType, callback)`

Registers an event listener. Returns `{ remove() }` to unregister.

#### DOM events

For any standard DOM event name (`"mousemove"`, `"mousedown"`, `"mouseup"`, `"click"`, `"dblclick"`, etc.), the callback receives the raw DOM event and the data coordinates at the cursor position:

```javascript
const handle = plot.on('mousemove', (e, coords) => {
  console.log(coords.xaxis_bottom, coords.yaxis_left)
})

handle.remove()
```

> **Note:** Listeners are registered on `window` in the capture phase so that they fire before D3 zoom's internal handlers (which call `stopImmediatePropagation` on `mouseup` for left-click pan gestures). Events are filtered to those whose `target` is inside the plot container, so multiple plots on the same page do not interfere. Events on gladly's own controls inside the container (elements marked `data-gladly-control`, such as the [typed axis limit](../configuration/PlotConfiguration.md#typed-axis-limits) field) are left out, so a click on it is not a click on the plot.

#### Synthetic plot events

Several special event types do not correspond to a plain DOM event. Two report rendering errors (`"error"` / `"no-error"`); `"axislimit"` and `"axisoptions"` report axis state the user (or your own code) changed; `"contextmenu"` is a cleaned-up right-click; and `"contextmenu_open"` fires when the built-in menu opens so you can augment it. The error events have no `coords`; the others do.

---

**`"error"`** — fired whenever a layer or transform fails (during initialisation or rendering). The failed item is skipped; all other layers continue to render normally.

```javascript
plot.on('error', (e) => {
  console.log(e.type)    // "error"
  console.log(e.message) // human-readable description
  console.log(e.error)   // the original Error object (with full stack)
})
```

---

**`"no-error"`** — fired once after a complete render cycle with no errors, but only if there was a prior error. Fires at most once per error episode — will not fire again unless a new error first occurs.

```javascript
plot.on('no-error', (e) => {
  console.log(e.type) // "no-error"
  // clear any error UI
})
```

Typical usage — show a red error banner that clears itself when the plot recovers:

```javascript
plot.on('error', (e) => {
  statusBar.textContent = e.message
  statusBar.style.background = 'red'
})
plot.on('no-error', () => {
  statusBar.textContent = ''
  statusBar.style.background = ''
})
```

---

**`"axislimit"`** — fired when the user types a value at one end of an axis (see [Typed axis limits](../configuration/PlotConfiguration.md#typed-axis-limits)). The new range is already set when it fires. It was set through `Axis.setDomain()`, so linked axes have followed, and `getConfig()` returns it.

```javascript
plot.on('axislimit', (e) => {
  console.log(e.type)   // "axislimit"
  console.log(e.axis)   // "xaxis_bottom", or a color or filter quantity kind
  console.log(e.end)    // "min" (the domain's first value) or "max" (its second)
  console.log(e.value)  // the number typed
  console.log(e.domain) // the axis's new [min, max]
})
```

A value typed on a colorbar or filterbar float fires on the plot the float belongs to, with `e.axis` set to that plot's color or filter quantity kind. Zoom and pan fire no event of their own, so this is the place to save a configuration the moment a limit is typed:

```javascript
plot.on('axislimit', () => saveLayout(plot.getConfig()))
```

---

**`"axisoptions"`** — fired when an axis-part key is written, by the [built-in axis menu](#built-in-axis-menu), a direct `update({ config })`, or `setAxisLocked()`. Like `"axislimit"`, it is keyed by **what** changed, not by who changed it, so a consumer persists on it without knowing a menu was involved. None of these keys propagate across `linkAxes` (the lock in particular is local to one plot), so there is no cross-plot source.

The reported keys fall into two groups by where they live in the config:

- **Per-slot keys** (`axes.<slot>`): `visible`, `tickLabelsVisible`, `titleVisible`, `locked`, `scale` (`"log"` / `"linear"`), `colorscale`, `colorbar` and `filterbar`. For these, `e.axis` is the slot string and `e.axis2d` is absent.
- **2D colour-pair keys** (`colorbars[]`, keyed by the ordered quantity-kind pair): `colorscale`, `colorbar` and `enabled`. A pair has no single slot, so for these `e.axis` is `null` and `e.axis2d` is the pair key `"<qkX>__<qkY>"` (the same key used by `plot.axis2d["<qkX>__<qkY>"]`).

```javascript
plot.on('axisoptions', (e) => {
  console.log(e.type)    // "axisoptions"
  console.log(e.axis)    // "xaxis_bottom", or null for a 2D colour pair
  console.log(e.axis2d)  // undefined, or "velocity_ms__density" for a 2D colour pair
  console.log(e.key)     // "visible" | "tickLabelsVisible" | "titleVisible" | "locked"
                         //   | "scale" | "colorscale" | "colorbar" | "filterbar" | "enabled"
  console.log(e.value)   // the new value for that key
})
```

Together with `"axislimit"` (for domain changes), this is everything needed to persist a layout the moment the user changes it:

```javascript
plot.on('axisoptions', () => saveLayout(plot.getConfig()))
plot.on('axislimit',   () => saveLayout(plot.getConfig()))
```

---

**`"contextmenu"`** — fired on a right press+release less than 5 px apart **that gladly did not otherwise use** (a press that closed a [lasso polygon](../user-api/Selection.md) or ended a 3D rotation does not count). It fires on the **release**, so it behaves the same whether the browser raises its own menu at the press (macOS) or the release (Windows); gladly keeps suppressing the browser's own menu on the canvas. This replaces the raw DOM `contextmenu` pass-through.

The callback receives a third argument, `region`, saying where the press was:

```javascript
plot.on('contextmenu', (e, coords, region) => {
  // region === null                              → a corner or an empty margin
  // region.type === 'plot_area'                  → inside the plot box
  // region.type === 'axis', region.axes[0]       → that one axis strip
})
```

The built-in menu (below) opens from this same event. The event fires whether or not the built-in menu is enabled, so with the menu gated off you can bind your own behaviour here.

#### Built-in axis menu

A right-click opens gladly's own menu: a **full menu** on a plot-area / corner / empty-margin click, or a **single-axis menu** (one spatial row, with **Reset axis**) on an axis-strip click. The checkboxes write the matching `axes.<slot>` keys and call `setAxisLocked()` / `resetAxes()`, so every change round-trips through `getConfig()` and emits `"axisoptions"` — the menu holds no state of its own. It works the same on 3D plots (a row per x/y/z axis).

The full menu has two tables:

- **Spatial axes** — a row per axis with **Axis** / **Labels** / **Title** / **Lock** checkboxes, a **Log** checkbox (the `scale` key, `'log'` ↔ `'linear'`), and **Reset view**.
- **Colour, 2D-colour and filter axes** (only in the full menu, since they are plot-wide) — below the spatial table:
  - a **colour axis** row has a colorscale dropdown (`axes[qk].colorscale`) and a tri-state **Bar** icon cycling none → vertical → horizontal (`axes[qk].colorbar`);
  - a **2D-colour pair** row has a 2D colorscale dropdown, a **Bar** checkbox and an **Enabled** checkbox — written through `plot.axis2d[key].setConfig(...)` (the `colorbars` entry);
  - a **filter axis** row has only the tri-state **Bar** icon (`axes[qk].filterbar`).

Two top-level config booleans gate it, both **default `true`**:

| key | gates |
|---|---|
| `plot_menu` | the full menu (plot-area / corner / empty-margin right-click) |
| `axis_menu` | the single-axis menu (axis-strip right-click) |

```javascript
plot.update({ config: { ...config, plot_menu: false, axis_menu: false } })
```

When a gate is `false`, gladly opens no menu for that region but the `"contextmenu"` event still fires, so a consumer can bind their own menu (or any behaviour) via `plot.on('contextmenu', …)`.

**`"contextmenu_open"`** — fired when the built-in menu actually opens, so a consumer can **augment** it rather than replace it. The callback is handed the fully-built menu element and mutates it in place — append rows or buttons, wire handlers, remove or restyle what gladly put there:

```javascript
plot.on('contextmenu_open', (e, coords, region, menuEl) => {
  // region?.type === 'axis'  → the single-axis menu; region.axes[0] is its axis slot
  // region plot-area / null  → the full menu
  const btn = document.createElement('button')
  btn.textContent = 'My action'
  btn.addEventListener('click', () => { /* … */ })
  menuEl.appendChild(btn)
})
```

- The first three parameters — `e`, `coords`, `region` — are **exactly** those of `"contextmenu"` (same press). `region` identifies which menu opened and, for an axis strip, which axis.
- `menuEl` is the menu's root `<div>` (`data-gladly-control="axis-menu"`), already attached to `document.body` and already refreshed. The event fires **after** the menu is built and its controls show their live values, and **before** it is positioned — so the menu is placed at its final size, staying inside the viewport after your changes.
- Use the two events for different goals: `"contextmenu_open"` **augments** the built-in menu and fires only when it opens; `"contextmenu"` fires on every qualifying press (built-in menu or not), so with `plot_menu` / `axis_menu` set to `false` it is where you **build your own** menu from scratch.
- The menu is rebuilt on every open, so the callback runs every time — it must not assume it runs once. gladly does not refresh controls you add; a listener that needs live-updating controls manages its own state. Multiple listeners are supported; an exception in one is caught, logged, and does not block the others or the menu.

---

### `pick(x, y)`

GPU-based hit-testing: renders all layers to an offscreen framebuffer with pick-encoded colors, reads back one pixel, and decodes which layer, tile, and data point occupies that position.

| Parameter | Type | Description |
|-----------|------|-------------|
| `x` | number | Container-relative pixel x |
| `y` | number | Container-relative pixel y |

Returns `null` if nothing was hit, or:

```javascript
{
  configLayerIndex: 0,  // index into config.layers[] (the user-facing layer list)
  layerIndex: 0,        // index into the internal GPU layer array (may differ when a layer type emits multiple draw calls)
  tile: 0,              // tile index (0 for non-tiled layers; 0..N-1 for N-tile layers)
  index: 12345,         // vertex index within the tile (non-instanced) or instance index (instanced layers)
  layer: <Layer>        // the Layer object — layer.attributes holds the raw data
}
```

To read the data values at the picked point:

```javascript
plot.on('mouseup', async (e) => {
  const rect = plot.container.getBoundingClientRect()
  const result = await plot.pick(e.clientX - rect.left, e.clientY - rect.top)
  if (!result) return

  const { configLayerIndex, tile, index, layer } = result
  const isInstanced = layer.instanceCount !== null

  // For non-tiled layers: tile is always 0, index is the row in the attribute arrays.
  // For tiled layers (Float32Array[] attributes): index is the row within tile `tile`.
  const attrs = Object.entries(layer.attributes)
    .filter(([k]) => !isInstanced || (layer.attributeDivisors[k] ?? 0) === 1)
  const tileAttrs = Object.fromEntries(
    attrs.map(([k, v]) => [k, Array.isArray(v) ? v[tile]?.[index] : v[index]])
  )
  console.log(`layer=${configLayerIndex} tile=${tile} index=${index}`, tileAttrs)
})
```

For instanced layers (e.g. `rects`), `index` is the **instance** index. Filter out per-vertex attributes (divisor 0) using `layer.attributeDivisors`.

`configLayerIndex` indexes into the `config.layers` array you passed to `plot.update()` and is the most useful identifier for application code. `layerIndex` indexes the internal GPU draw-call array, which may differ when a single layer spec produces multiple draw calls.

Pick supports up to 255 layers and ~16 million data points per layer.

---

### `destroy()`

Removes event listeners and destroys the WebGL context.

---

## Static methods

### `Plot.schema()`

Returns JSON Schema (Draft 2020-12) for the plot configuration object, aggregated from all registered layer types.
