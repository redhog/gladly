# Plot

The main plotting container that manages WebGL rendering and SVG axes.

---

## Constructor

```javascript
new Plot(container, { margin } = {})
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Parent `<div>`. Must have explicit CSS dimensions. Canvas and SVG are created inside it automatically. |
| `margin` | object | Plot margin in px: `{ top, right, bottom, left }`. Defaults to `{ top: 60, right: 60, bottom: 60, left: 60 }`. |

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

The result can be passed back to `update({ config })` to restore the exact current view, or serialised for state-saving / cross-plot synchronisation.

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

> **Note:** Listeners are registered on `window` in the capture phase so that they fire before D3 zoom's internal handlers (which call `stopImmediatePropagation` on `mouseup` for left-click pan gestures). Events are filtered to those whose `target` is inside the plot container, so multiple plots on the same page do not interfere.

#### Synthetic plot events

Two special event types report rendering errors. They do not correspond to DOM events and have no `coords` argument.

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

### `pick(x, y)`

GPU-based hit-testing: renders all layers to an offscreen framebuffer with pick-encoded colors, reads back one pixel, and decodes which layer and data point occupies that position.

| Parameter | Type | Description |
|-----------|------|-------------|
| `x` | number | Container-relative pixel x |
| `y` | number | Container-relative pixel y |

Returns `null` if nothing was hit, or:

```javascript
{
  configLayerIndex: 0,    // index into config.layers[] (the user-facing layer list)
  layerIndex: 0,          // index into the internal GPU layer array (may differ when a layer type emits multiple draw calls)
  dataIndex: 12345,       // vertex index (non-instanced) or instance index (instanced layers)
  layer: <Layer>          // the Layer object — layer.attributes holds the raw Float32Arrays
}
```

To read the data values at the picked point:

```javascript
plot.on('mouseup', (e) => {
  const rect = plot.container.getBoundingClientRect()
  const result = plot.pick(e.clientX - rect.left, e.clientY - rect.top)
  if (!result) return

  const { configLayerIndex, dataIndex, layer } = result
  const isInstanced = layer.instanceCount !== null
  const row = Object.fromEntries(
    Object.entries(layer.attributes)
      .filter(([k]) => !isInstanced || (layer.attributeDivisors[k] ?? 0) === 1)
      .map(([k, v]) => [k, v[dataIndex]])
  )
  console.log(`layer=${configLayerIndex} index=${dataIndex}`, row)
})
```

For instanced layers (e.g. `rects`), `dataIndex` is the **instance** index. Filter out per-vertex attributes (divisor 0) using `layer.attributeDivisors`.

`configLayerIndex` indexes into the `config.layers` array you passed to `plot.update()` and is the most useful identifier for application code. `layerIndex` indexes the internal GPU draw-call array, which may differ from `configLayerIndex` when a single layer spec produces multiple draw calls.

Pick supports up to 255 layers and ~16 million data points per layer.

---

### `destroy()`

Removes event listeners and destroys the WebGL context.

---

## Static methods

### `Plot.schema()`

Returns JSON Schema (Draft 2020-12) for the plot configuration object, aggregated from all registered layer types.
