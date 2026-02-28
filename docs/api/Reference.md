# API Reference

Public API entries exposed by `./src/index.js`. For conceptual background see the [main API doc](../API.md). For plot configuration see [Configuring Plots](PlotConfiguration.md). For writing layer types see [Writing Layer Types](LayerTypes.md).

---

## `Plot`

The main plotting container that manages WebGL rendering and SVG axes.

**Constructor:**
```javascript
new Plot(container, { margin } = {})
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Parent `<div>`. Must have explicit CSS dimensions. Canvas and SVG are created inside it automatically. |
| `margin` | object | Plot margin in px: `{ top, right, bottom, left }`. Defaults to `{ top: 60, right: 60, bottom: 60, left: 60 }`. |

**Instance properties:**

### `plot.axes`

A proxy object that returns a stable [`Axis`](#axis) instance for any axis name:

```javascript
plot.axes.xaxis_bottom   // spatial axis
plot.axes.xaxis_top
plot.axes.yaxis_left
plot.axes.yaxis_right
plot.axes["velocity_ms"] // color or filter axis, keyed by quantity kind
```

The same `Axis` instance is returned on every access, including across `plot.update()` calls. This makes it safe to pass axis references to `linkAxes()` before or after `update()`.

**Instance methods:**

### `update({ config, data })`

Updates the plot with new configuration and/or data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | `{ layers, axes }` — see [Configuring Plots](PlotConfiguration.md) |
| `config.layers` | array | Layer specifications: `[{ typeName: params }, ...]` |
| `config.axes` | object | Range overrides for spatial, color, and filter axes |
| `data` | object | Named `Float32Array` values |

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

Registers an event listener that fires for any DOM event originating within the plot container, calling `callback` with both the raw event and the data coordinates at the mouse position.

| Parameter | Type | Description |
|-----------|------|-------------|
| `eventType` | string | Any DOM event name: `"mousemove"`, `"mousedown"`, `"mouseup"`, `"click"`, `"dblclick"`, etc. |
| `callback` | function | `(event, coords) => void` — receives the raw DOM event and the result of `lookup()` at the cursor position |

Returns `{ remove() }` to unregister the listener.

```javascript
const handle = plot.on('mousemove', (e, coords) => {
  console.log(coords.xaxis_bottom, coords.yaxis_left)
})

// Later:
handle.remove()
```

> **Note:** Listeners are registered on `window` in the capture phase so that they fire before D3 zoom's internal handlers (which call `stopImmediatePropagation` on `mouseup` for left-click pan gestures). Events are filtered to those whose `target` is inside the plot container, so multiple plots on the same page do not interfere.

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

**Static methods:**

### `Plot.schema()`

Returns JSON Schema (Draft 2020-12) for the plot configuration object, aggregated from all registered layer types.

---

## `Axis`

A first-class object representing a single axis on a plot. Obtained via `plot.axes[axisName]`.

Axis instances are stable — the same object is returned across `plot.update()` calls, so links survive reconfiguration.

**Interface** (also accepted by `linkAxes()` for duck typing):

### `axis.quantityKind`

`string | null` — the quantity kind for this axis. `null` before the plot has been initialized with `update()`.

### `axis.getDomain()`

Returns `[min, max]` or `null` if the axis has no domain yet.

For filter axes, either bound may be `null` (open bound).

### `axis.setDomain(domain)`

Sets the axis domain, schedules a render on the owning plot, and notifies all subscribers (e.g. axes linked via `linkAxes`).

A re-entrancy guard prevents infinite loops when axes are linked bidirectionally.

### `axis.subscribe(callback)`

Adds a subscriber. `callback([min, max])` is called after every `setDomain()` on this axis.

### `axis.unsubscribe(callback)`

Removes a previously added subscriber.

---

## `linkAxes(axis1, axis2)`

Links two axes bidirectionally. When either axis's domain changes via `setDomain()`, the other is updated to match.

```javascript
linkAxes(plot1.axes.xaxis_bottom, plot2.axes.xaxis_top)
```

Quantity kinds are validated at call time if both axes have known quantity kinds (i.e. after `update()` has been called on both plots). Incompatible kinds throw an error.

Returns `{ unlink() }` to tear down the link.

Any object implementing the [`Axis` interface](#axis) may be passed — see [Custom axis objects](#custom-axis-objects) below.

### Unlinking

Store the return value and call `unlink()` when the connection should be removed:

```javascript
const link = linkAxes(plot1.axes.xaxis_bottom, plot2.axes.xaxis_top)

// Later — e.g. when the user switches views, or one plot is destroyed:
link.unlink()
```

After `unlink()` the two axes are fully independent again. If a `Plot` is destroyed with `plot.destroy()`, its axis listeners are cleared automatically, but the complementary side of any link still holds a dead callback. Explicitly calling `unlink()` before destroying a plot is the clean way to avoid that.

---

## Custom axis objects

Any object that satisfies the `Axis` interface can be passed to `linkAxes()`. This lets you synchronise a Gladly axis with external state — a UI control, another charting library, server state, a URL parameter, etc.

### The interface contract

| Member | Type | Requirement |
|--------|------|-------------|
| `quantityKind` | `string \| null` | Identifies the physical quantity. Used for compatibility validation in `linkAxes`. May be `null` if unknown. |
| `getDomain()` | `() => [min, max] \| null` | Returns the current domain, or `null` if not yet set. |
| `setDomain(domain)` | `([min, max]) => void` | Sets the domain **and** notifies all subscribers. Must implement a re-entrancy guard (see below). |
| `subscribe(callback)` | `(([min, max]) => void) => void` | Registers a callback to be called by `setDomain`. |
| `unsubscribe(callback)` | `(([min, max]) => void) => void` | Removes a previously registered callback. |

### The re-entrancy guard

`linkAxes` wires each axis so that when axis A calls `setDomain`, axis B's `setDomain` is called, and vice-versa. Without a guard this causes an infinite loop. The built-in `Axis` class breaks the cycle with a boolean flag:

- Before calling subscribers, set `_propagating = true`.
- At the top of `setDomain`, return immediately if `_propagating` is already `true`.
- Reset `_propagating = false` in a `finally` block.

Any custom implementation must do the same.

### Minimal example

```javascript
class ExternalAxis {
  constructor(quantityKind) {
    this.quantityKind = quantityKind
    this._domain = null
    this._listeners = new Set()
    this._propagating = false
  }

  getDomain() {
    return this._domain
  }

  setDomain(domain) {
    if (this._propagating) return   // re-entrancy guard
    this._propagating = true
    try {
      this._domain = domain
      this._onDomainChanged(domain) // update your own state / UI here
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }

  _onDomainChanged(domain) {
    // Override or extend to react to changes, e.g. update a UI widget.
  }
}
```

Usage:

```javascript
const externalAxis = new ExternalAxis("velocity_ms")
const link = linkAxes(plot.axes["velocity_ms"], externalAxis)

// Pan/zoom on the plot → externalAxis._domain is updated automatically.
// Call externalAxis.setDomain([0, 10]) → plot re-renders with the new range.
// link.unlink() when you no longer want the two to be connected.
```

### Example: syncing with a range slider

```javascript
class SliderAxis {
  constructor(quantityKind, minInput, maxInput) {
    this.quantityKind = quantityKind
    this._minInput = minInput
    this._maxInput = maxInput
    this._domain = null
    this._listeners = new Set()
    this._propagating = false

    const notify = () => {
      const domain = [parseFloat(minInput.value), parseFloat(maxInput.value)]
      this.setDomain(domain)
    }
    minInput.addEventListener('input', notify)
    maxInput.addEventListener('input', notify)
  }

  getDomain() { return this._domain }

  setDomain(domain) {
    if (this._propagating) return
    this._propagating = true
    try {
      this._domain = domain
      // Keep sliders in sync when the plot's zoom changes the domain.
      this._minInput.value = domain[0]
      this._maxInput.value = domain[1]
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }
}

const slider = new SliderAxis("velocity_ms",
  document.getElementById("min-slider"),
  document.getElementById("max-slider")
)
const link = linkAxes(plot.axes["velocity_ms"], slider)
```

---

## `registerEpsgDef(epsgCode, proj4string)`

Pre-registers a proj4 CRS definition and the matching `epsg_CODE_x` / `epsg_CODE_y` quantity kinds. Use this in environments without network access (air-gapped, offline apps) where the `tile` layer cannot fetch definitions from `epsg.io`.

```javascript
import { registerEpsgDef } from 'gladly-plot'

registerEpsgDef(26911, '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs')
```

The quantity kind labels are looked up from `projnames` (e.g. EPSG:26911 → `"NAD83 / UTM zone 11N X"` and `"NAD83 / UTM zone 11N Y"`). Proj4 strings for any code can be obtained from [epsg.io](https://epsg.io) (append `.proj4` to the code URL).

**When not needed:** In network-connected environments the `tile` layer automatically fetches and registers any unrecognised CRS on first use — `registerEpsgDef` is only required when you need guaranteed offline operation, or when you want to register quantity kinds for scatter/line data before the tile layer initialises.

---

## `registerLayerType(name, layerType)`

Registers a LayerType under a name for use in `config.layers`.

```javascript
registerLayerType("points", pointsLayerType)
```

Throws if `name` is already registered.

---

## `getLayerType(name)`

Returns the registered `LayerType` for `name`. Throws with a helpful message if not found.

---

## `getRegisteredLayerTypes()`

Returns an array of all registered layer type name strings.

---

## `registerAxisQuantityKind(name, definition)`

Registers (or merges into) the definition for a quantity kind. Quantity kinds are strings that identify what an axis measures (e.g. `"velocity_ms"`, `"temperature_K"`). Registering a quantity kind lets the library use the correct label and default scale/colorscale everywhere that quantity kind appears, without having to repeat those settings in every `config.axes` block.

```javascript
registerAxisQuantityKind("velocity_ms", {
  label:      "Velocity (m/s)",
  scale:      "linear",
  colorscale: "Blues"
})
```

**Definition fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | `string` | the name itself | Human-readable axis label rendered next to the axis. |
| `scale` | `"linear"` \| `"log"` | `"linear"` | Default scale type for spatial axes using this quantity kind. Can be overridden per-plot in `config.axes[name].scale`. |
| `colorscale` | `string` | — | Default colorscale name for color axes using this quantity kind (e.g. `"viridis"`, `"plasma"`). Can be overridden per-plot in `config.axes[name].colorscale`. |

If `name` was already registered, the new definition is **merged** into the existing one (existing fields that are not present in the new definition are preserved). This differs from `registerLayerType`, which throws on duplicate names.

Quantity kinds do not need to be registered — any string is accepted everywhere a quantity kind is expected. An unregistered name gets `{ label: name, scale: "linear" }` as its implicit definition.

---

## `getAxisQuantityKind(name)`

Returns the definition object for a quantity kind. If `name` has not been registered, returns `{ label: name, scale: "linear" }` without adding it to the registry.

```javascript
const def = getAxisQuantityKind("velocity_ms")
// { label: "Velocity (m/s)", scale: "linear", colorscale: "Blues" }
```

---

## `getRegisteredAxisQuantityKinds()`

Returns an array of all registered quantity kind name strings.

---

## `Data`

A utility class that normalises plain JavaScript objects of various shapes into a consistent columnar interface.

> **This class is completely optional.** The plotting framework itself never inspects or requires any particular shape for the `data` object passed to `plot.update()` — it is passed through unchanged to each layer type's `createLayer` and `getAxisConfig` functions. Only the built-in layer types call `Data.wrap`, and custom layer type authors may adopt it voluntarily for the same benefit.

### Supported plain-object formats

**Simple** — a flat object of `Float32Array` values (no metadata):

```javascript
{
  x: new Float32Array([...]),
  y: new Float32Array([...]),
  v: new Float32Array([...])
}
```

**Per-column rich** — each column is an object with a `data` array and optional metadata:

```javascript
{
  x: { data: new Float32Array([...]), quantity_kind: "distance_m", domain: [0, 10] },
  y: { data: new Float32Array([...]), quantity_kind: "voltage_V" },
  v: { data: new Float32Array([...]), quantity_kind: "temperature_K", domain: { min: 0, max: 100 } }
}
```

**Columnar** — data arrays, quantity kinds, and domains kept in parallel sub-objects:

```javascript
{
  data: {
    x: new Float32Array([...]),
    y: new Float32Array([...]),
    v: new Float32Array([...])
  },
  quantity_kinds: {           // optional — any entry can be omitted
    x: "distance_m",
    y: "voltage_V",
    v: "temperature_K"
  },
  domains: {                  // optional — any entry can be omitted
    x: [0, 10],               // [min, max] array, or
    v: { min: 0, max: 100 }   // {min, max} object — both forms accepted
  }
}
```

In all formats, `quantity_kind` / `quantity_kinds` and `domain` / `domains` are fully optional on any individual column. Missing quantity kinds fall back to the column name; missing domains are auto-calculated from the data array.

### `Data.wrap(data)`

```javascript
import { Data } from './src/index.js'
const d = Data.wrap(rawData)
```

The primary entry point. Returns `data` **unchanged** if it already has `columns` and `getData` methods (duck-typing — any conforming class works, not just `Data` itself). Otherwise wraps the plain object, auto-detecting which format it uses.

### `data.columns()`

Returns `string[]` — the list of column names.

### `data.getData(col)`

Returns the `Float32Array` for column `col`, or `undefined` if the column does not exist.

### `data.getQuantityKind(col)`

Returns the quantity kind string for column `col`, or `undefined` if none was specified. Layer type authors typically fall back to the column name when undefined:

```javascript
const qk = d.getQuantityKind(params.vData) ?? params.vData
```

When a quantity kind is present, it is used as the axis identity (the key in `config.axes`) instead of the raw column name. This means two datasets that call the same physical quantity the same thing will automatically share axes.

### `data.getDomain(col)`

Returns `[min, max]` for column `col`, or `undefined` if no domain was specified. When returned, the built-in layers pass it as the `domains` entry in the `createLayer` return value, which tells the plot to skip its own min/max scan of the data array for that axis.

---

## Built-in Layer Types

Gladly ships five pre-registered layer types — `points`, `lines`, `tile`, `colorbar`, and `filterbar`. See [Built-in Layer Types](BuiltInLayerTypes.md) for full documentation.

---

## `Colorbar`

A specialised plot that renders a color gradient and keeps itself in sync with a target plot's color axis.

Typically auto-created by setting `axes[quantityKind].colorbar: "horizontal"` or `"vertical"` in `config`. For manual creation and full API see [Colorbars and Filterbars](ColorbarsAndFilterbars.md#colorbar).

---

## `Float`

A draggable, resizable floating panel that wraps a `Colorbar` inside the parent plot's container.

Typically auto-created alongside the colorbar when `axes[quantityKind].colorbar` is set. For manual creation and full API see [Colorbars and Filterbars](ColorbarsAndFilterbars.md#float).

---

## `Filterbar`

A specialised plot that displays a filter axis range and lets the user adjust it interactively.

Typically auto-created by setting `axes[quantityKind].filterbar: "horizontal"` or `"vertical"` in `config`. For manual creation and full API see [Colorbars and Filterbars](ColorbarsAndFilterbars.md#filterbar).

---

## `FilterbarFloat`

A draggable, resizable floating panel that wraps a `Filterbar` inside the parent plot's container.

Typically auto-created alongside the filterbar when `axes[quantityKind].filterbar` is set. For manual creation and full API see [Colorbars and Filterbars](ColorbarsAndFilterbars.md#filterbarfloat).
