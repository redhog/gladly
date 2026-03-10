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
| `data` | object | Any plain object that `normalizeData()` can convert to a `DataGroup` tree (see [Data Format](../API.md#data-format)) |

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

## `PlotGroup`

Coordinates a set of named [`Plot`](#plot) instances with atomic multi-plot updates and optional auto-linking of axes that share the same quantity kind.

**Constructor:**
```javascript
new PlotGroup(plots, { autoLink } = {})
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `plots` | `{ [name]: Plot }` | Initial named plots. May be `{}`. |
| `autoLink` | boolean | Default `false`. When `true`, axes sharing the same quantity kind across member plots are automatically linked and reconciled on every `update()`. |

**Instance methods:**

### `plotGroup.update({ data, plots })`

Normalises `data` once (all plots share the same `DataGroup` instance), calls `plot.update()` on every mentioned plot, then reconciles auto-links. See [PlotGroup](PlotGroup.md#plotgroupupdatedata-plots) for full details.

### `plotGroup.add(name, plot)`

Adds a named plot to the group and reconciles auto-links.

### `plotGroup.remove(name)`

Removes a named plot, tearing down auto-managed links that involve it.

### `plotGroup.destroy()`

Tears down all auto-managed links. Does not destroy the individual plots.

For full documentation, examples, and auto-linking behaviour see **[PlotGroup](PlotGroup.md)**.

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

**Links are silent during `plot.update()`.**  `plot._initialize()` sets D3 scale domains directly (bypassing `axis.setDomain()`), so linked axes are never notified when a plot is reconfigured. Links only fire on user interaction (zoom/pan) or explicit `axis.setDomain()` calls. This means it is safe to have a link between two plots and call `plot.update()` on both — even if the update changes quantity kinds — without the link firing in an intermediate state or throwing.

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

## `Computation`

Abstract base class for all computations. Subclass `TextureComputation` or `GlslComputation` rather than this directly.

```javascript
import { Computation } from 'gladly-plot'
```

**Method to implement:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `schema(data)` | `(data: Data \| null) => JSONSchema` | Return a JSON Schema (Draft 2020-12) describing the `params` object the computation accepts. Use `EXPRESSION_REF` for params that accept a `Float32Array` or sub-expression. |

---

## `TextureComputation`

Base class for computations that produce a regl texture. Extend this to register a new texture computation.

```javascript
import { TextureComputation, ArrayColumn, EXPRESSION_REF, registerTextureComputation } from 'gladly-plot'

class MyComp extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    // inputs: resolved parameter object.
    // - String params that matched data columns are ColumnData instances.
    // - Use inputs.col.toTexture(regl) to get a GPU texture from any ColumnData.
    // - Check `inputs.col instanceof ArrayColumn` for CPU-accessible data; use .array.
    // - Numbers, booleans, and Float32Array values pass through unchanged.
    // getAxisDomain(axisId): returns [min|null, max|null]; registers axis as dependency.
    // Returns a regl texture (R channel, 1 value/texel, 2D layout).
  }
  schema(data) {
    return {
      type: 'object',
      properties: { input: EXPRESSION_REF, bins: { type: 'number' } },
      required: ['input']
    }
  }
}

registerTextureComputation('myComp', new MyComp())
```

In `createLayer`, reference the computation as an attribute value (column names or expressions):

```javascript
attributes: {
  count: { myComp: { input: 'myColumn', bins: 50 } }
}
```

The framework calls `getAxisDomain` to detect axis dependencies and automatically recomputes the texture when a dependent axis domain changes (e.g. a filterbar is adjusted).

For built-in computations, parameter details, and a full worked example see [Computed Attributes](ComputedAttributes.md).

---

## `GlslComputation`

Base class for computations that produce a GLSL expression string. The expression is injected directly into the vertex shader.

```javascript
import { GlslComputation, EXPRESSION_REF, registerGlslComputation } from 'gladly-plot'

class NormalizedDiff extends GlslComputation {
  glsl({ a, b }) {
    return `((${a}) - (${b})) / ((${a}) + (${b}) + 1e-6)`
  }
  schema(data) {
    return {
      type: 'object',
      properties: { a: EXPRESSION_REF, b: EXPRESSION_REF },
      required: ['a', 'b']
    }
  }
}

registerGlslComputation('normalizedDiff', new NormalizedDiff())
```

Each value in the `glsl()` parameter object is already a GLSL expression string (not a JS value). Return a GLSL `float` expression.

See [Computed Attributes](ComputedAttributes.md) for the full API.

---

## `registerTextureComputation(name, computation)`

Registers a `TextureComputation` instance under `name`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Key used in attribute expressions: `{ [name]: params }` |
| `computation` | `TextureComputation` | Instance of a class extending `TextureComputation` |

---

## `registerGlslComputation(name, computation)`

Registers a `GlslComputation` instance under `name`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Key used in attribute expressions: `{ [name]: params }` |
| `computation` | `GlslComputation` | Instance of a class extending `GlslComputation` |

---

## `EXPRESSION_REF`

```javascript
import { EXPRESSION_REF } from 'gladly-plot'
```

A JSON Schema `$ref` (`{ '$ref': '#/$defs/expression' }`) for use inside `schema()` methods. Marks a parameter as accepting a column name string, a `Float32Array`, or a nested computation expression. The framework resolves column names and expressions to `ColumnData` instances before passing them to `compute()`. See [Computed Attributes — EXPRESSION_REF](ComputedAttributes.md#expression_ref).

---

## `computationSchema(data)`

```javascript
import { computationSchema } from 'gladly-plot'
const schema = computationSchema(data)
```

Returns a JSON Schema Draft 2020-12 document covering the full space of valid computation expressions: column name references and every registered computation, with `$defs` enabling recursive sub-expressions. See [Computed Attributes — computationSchema](ComputedAttributes.md#computationschemadata).

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Data \| null` | Used to enumerate column names for the `expression` `anyOf`. Pass `null` when no data is available. |

---

## `ColumnData`, `ArrayColumn`, `TextureColumn`, `GlslColumn`, `OffsetColumn`

The unified column data hierarchy. All columnar values in the computation pipeline — whether they come from `Data.getData()`, a `TextureComputation`, a `GlslComputation`, or a `col.withOffset()` call — are represented as one of these classes.

```javascript
import { ColumnData, ArrayColumn, TextureColumn, GlslColumn, OffsetColumn } from 'gladly-plot'
```

**Subtypes:**

| Class | Source | GPU access | CPU access |
|-------|--------|------------|------------|
| `ArrayColumn` | `Data.getData()` — wraps a `Float32Array` | `col.toTexture(regl)` (lazy upload) | `col.array` |
| `TextureColumn` | `TextureComputation.createColumn()` — wraps a mutable `{ texture }` ref | `col.toTexture(regl)` | — |
| `GlslColumn` | `GlslComputation.createColumn()` — composes a GLSL expression from named inputs | `col.toTexture(regl)` (GPU scatter pass) | — |
| `OffsetColumn` | `col.withOffset(glslExpr)` — shifts the sampling index in the vertex shader | delegates to base | delegates to base |

**Common interface** (all subtypes):

| Member | Description |
|--------|-------------|
| `col.length` | Number of data elements, or `null` if unknown |
| `col.domain` | `[min, max]` or `null` |
| `col.quantityKind` | string or `null` |
| `col.resolve(path, regl)` | Returns `{ glslExpr: string, textures: { uniformName: () => tex } }` for shader injection |
| `col.toTexture(regl)` | Returns a raw regl texture (R channel, 2D layout) |
| `col.refresh(plot)` | Refreshes if axis-reactive; returns `true` if updated |
| `col.withOffset(glslExpr)` | Returns an `OffsetColumn` that samples at `a_pickId + (glslExpr)` |

**`ArrayColumn` extras:**
- `col.array` — the raw `Float32Array` (CPU-accessible)

**`OffsetColumn`** is used in instanced rendering to read consecutive data points from the same underlying column without building interleaved CPU arrays:

```javascript
// Both attributes read from the same colX, offset by 0 or 1 per instance
attributes: {
  x0: colX.withOffset('0.0'),   // segment start
  x1: colX.withOffset('1.0'),   // segment end
  xi: colX.withOffset('a_endPoint'),  // per-vertex interpolation via template attribute
}
```

Use `instanceof ArrayColumn` guards in `TextureComputation.compute()` when CPU data is required.

---

## `uploadToTexture(regl, array)`

```javascript
import { uploadToTexture } from 'gladly-plot'
const tex = uploadToTexture(regl, float32Array)
```

Uploads a `Float32Array` as an R-channel, one-value-per-texel, 2D GPU texture. Sets `tex._dataLength = array.length`. Use this inside `TextureComputation.compute()` to convert a CPU result into a returnable texture.

---

## `resolveExprToColumn(expr, data, regl, plot)`

```javascript
import { resolveExprToColumn } from 'gladly-plot'
const col = resolveExprToColumn(expr, data, regl, plot)  // → ColumnData
```

Resolves any expression to a `ColumnData` instance: passes through existing `ColumnData`, looks up string column names, or runs registered computations.

---

## `SAMPLE_COLUMN_GLSL`

```javascript
import { SAMPLE_COLUMN_GLSL } from 'gladly-plot'
```

A GLSL helper string defining `sampleColumn(sampler2D tex, float idx) → float`. Automatically injected by the framework into any vertex shader that uses column data. Import it directly only when writing custom GPU compute passes that need to sample column textures.

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

A class that normalises a flat plain JavaScript dataset into a consistent columnar interface. `getData()` always returns a `ColumnData` instance.

The framework calls `normalizeData()` on the `data` argument to `plot.update()`, which uses `Data.wrap()` internally. The result is always a `DataGroup` tree whose leaves are `Data` instances. Layer types receive this normalised `DataGroup` as their `data` argument and call `Data.wrap(data)` on it (a no-op when already normalised).

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

The primary entry point. Returns `data` **unchanged** if it already has `columns` and `getData` methods (duck-typing — any conforming class works, not just `Data` itself). Otherwise inspects the plain object and selects the appropriate wrapper:

| Input shape | Result |
|-------------|--------|
| Already has `columns` + `getData` methods | returned unchanged |
| Has a top-level `data` key whose value is a plain object | `Data` — columnar format |
| All top-level values are `Float32Array` | `Data` — simple format |
| All top-level values are `{ data: Float32Array, ... }` | `Data` — per-column rich format |
| Any other case (top-level values are plain objects) | [`DataGroup`](#datagroup) — hierarchical |

When a `DataGroup` is created, each child value is recursively passed through `Data.wrap()`, so any nesting depth is handled automatically.

### `data.columns()`

Returns `string[]` — the list of column names.

### `data.getData(col)`

Returns a `ColumnData` instance (`ArrayColumn` for plain `Float32Array` data) for column `col`, or `null` if the column does not exist. To get the underlying `Float32Array`, use `col.array` (only on `ArrayColumn` instances); to upload as a GPU texture use `col.toTexture(regl)` (any `ColumnData` subtype).

```javascript
const col = d.getData('x')   // → ArrayColumn (or null)
if (col instanceof ArrayColumn) {
  const arr = col.array      // Float32Array (CPU access)
}
const tex = col.toTexture(regl)  // regl texture (any ColumnData subtype)
```

### `data.getQuantityKind(col)`

Returns the quantity kind string for column `col`, or `null`/`undefined` if none was specified. Layer type authors typically fall back to the column name when undefined:

```javascript
const qk = d.getQuantityKind(params.vData) ?? params.vData
```

When a quantity kind is present, it is used as the axis identity (the key in `config.axes`) instead of the raw column name. This means two datasets that call the same physical quantity the same thing will automatically share axes.

### `data.getDomain(col)`

Returns `[min, max]` for column `col`, or `undefined` if no domain was specified. When returned, the built-in layers pass it as the `domains` entry in the `createLayer` return value, which tells the plot to skip its own min/max scan of the data array for that axis.

---

## `DataGroup`

A class that wraps a **nested** object — where the top-level values are themselves data collections rather than typed arrays — into a consistent hierarchical interface. Column names are expressed in **dot notation**: `"child.column"` or `"subgroup.child.column"` at any depth. `getData()` always returns a `ColumnData` instance.

`DataGroup` is the top-level container produced by `normalizeData()`. The framework stores the normalised `DataGroup` as `plot.currentData` and passes it as the `data` argument to every layer type's `createLayer` and `getAxisConfig`. It is created automatically by `Data.wrap()` when the input is a nested object; you do not normally construct it directly.

### Examples

**Nested datasets → `DataGroup` of flat `Data` objects:**

```javascript
import { Data } from './src/index.js'

const group = Data.wrap({
  survey1: { x: new Float32Array([1, 2, 3]), y: new Float32Array([4, 5, 6]) },
  survey2: { x: new Float32Array([7, 8, 9]), y: new Float32Array([0, 1, 2]) }
})
// → DataGroup
//   group.columns()            → ['survey1.x', 'survey1.y', 'survey2.x', 'survey2.y']
//   group.getData('survey1.x') → Float32Array([1, 2, 3])
//   group.listData()           → { survey1: Data, survey2: Data }
```

**Columnar children → each child is detected as columnar `Data`:**

```javascript
const group = Data.wrap({
  run1: {
    data: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
    quantity_kinds: { depth: 'depth_m', vp: 'velocity_ms' }
  },
  run2: {
    data: { depth: new Float32Array([...]), vp: new Float32Array([...]) }
  }
})
// group.getQuantityKind('run1.depth') → 'depth_m'
// group.getData('run2.vp')           → Float32Array([...])
```

**Multi-level nesting → `DataGroup` of `DataGroup` of `Data`:**

```javascript
const group = Data.wrap({
  region_a: {
    shallow: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
    deep:    { depth: new Float32Array([...]), vp: new Float32Array([...]) }
  },
  region_b: { depth: new Float32Array([...]), vp: new Float32Array([...]) }
})
// group.columns() →
//   ['region_a.shallow.depth', 'region_a.shallow.vp',
//    'region_a.deep.depth',    'region_a.deep.vp',
//    'region_b.depth',         'region_b.vp']
// group.subgroups()  → { region_a: DataGroup }
// group.listData()   → { region_b: Data }
```

### `dataGroup.listData()`

Returns `{ [key]: Data }` — a plain object of the immediate children that are `Data` instances (not sub-groups).

### `dataGroup.subgroups()`

Returns `{ [key]: DataGroup }` — a plain object of the immediate children that are `DataGroup` instances.

### `dataGroup.columns()`

Returns all dotted column names recursively across all children. The order follows insertion order of the top-level keys, recursing depth-first.

### `dataGroup.getData(col)`

Returns the `ColumnData` instance for the dotted column name `col`, or `undefined` if the path does not exist. Delegates to the appropriate child `Data` or `DataGroup` node.

### `dataGroup.getQuantityKind(col)`

Returns the quantity kind string for the dotted column name, or `undefined` if none was specified.

### `dataGroup.getDomain(col)`

Returns `[min, max]` for the dotted column name, or `undefined` if none was specified.

---

## `ComputePipeline`

A headless GPU compute pipeline for running data transforms without any visual output. It creates its own offscreen WebGL context — no DOM container or `<canvas>` element is needed.

`ComputePipeline` uses the same [transform system](../API.md#transforms) as `Plot` (`config.transforms`), including filter axes. Use it to run computations server-side, in workers, or any time you need GPU-accelerated results as CPU arrays.

**Constructor:**
```javascript
new ComputePipeline()
```

No arguments. The WebGL context is created immediately in the constructor.

**Instance properties:**

### `pipeline.axes`

A proxy that returns a stable [`Axis`](#axis) instance for any registered filter axis name:

```javascript
pipeline.axes["depth_m"].getDomain()          // [min, max] or null
pipeline.axes["depth_m"].setDomain([0, 500])  // update filter range
```

Axis instances are stable across `update()` calls. They support `subscribe()` / `unsubscribe()` and can be linked to axes on a `Plot` or another `ComputePipeline` via [`linkAxes()`](#linkaxesaxis1-axis2):

```javascript
// Sync the filter on a plot's filterbar to the pipeline's filter axis
linkAxes(plot.axes["depth_m"], pipeline.axes["depth_m"])
```

Only **filter axes** are meaningful on a `ComputePipeline` (there are no spatial or color axes). Axis instances are created on first access; they become non-null after the first `update()` call that registers the axis.

**Instance methods:**

### `update({ data, transforms, axes })`

Runs the given transforms over `data` and returns a [`ComputeOutput`](#computeoutput).

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | object | Input data — any plain object that `normalizeData()` can convert (see [Data Format](../API.md#data-format)). Omit to reuse the data from the previous `update()` call. |
| `transforms` | array | Array of `{ name, transform: { ClassName: params } }` objects, in the same format as `config.transforms` in `Plot`. Default: `[]`. |
| `axes` | object | Filter axis range overrides: `{ [quantityKind]: { min, max } }`. Either bound may be omitted for an open interval. Default: `{}`. |

**Behaviour:**

Transforms are run in declaration order. Each transform can reference columns from `data` (as `"input.colName"`) or from a previously declared transform output (as `"transformName.colName"`).

Filter axis ranges are applied **after** transforms register their axes (so the range is always set on an axis that exists). Transforms whose output depends on a filter axis are then re-run with the configured range in place.

```javascript
const pipeline = new ComputePipeline()

const output = pipeline.update({
  data: { depth: new Float32Array([...]), vp: new Float32Array([...]) },
  transforms: [
    { name: 'hist', transform: { HistogramData: { input: 'input.vp', bins: 64 } } }
  ],
  axes: {
    // If the transform registers a filter axis, set its range here:
    depth_m: { min: 0, max: 3000 }
  }
})

const counts = output.getData('hist.counts').getArray()  // Float32Array
const centers = output.getData('hist.binCenters').getArray()
```

### `destroy()`

Destroys the WebGL context and frees GPU resources. After `destroy()`, calling `update()` will throw.

---

## `ComputeOutput`

The object returned by [`ComputePipeline.update()`](#updatedata-transforms-axes). Provides access to transform output columns as CPU arrays.

Column names use dot notation: input data columns are under `"input.*"`, and each transform's outputs are under `"transformName.*"` (matching the `name` given in the `transforms` array).

### `output.columns()`

Returns `string[]` — all available dotted column names, including both input data columns and transform outputs.

```javascript
output.columns()
// ['input.depth', 'input.vp', 'hist.counts', 'hist.binCenters', ...]
```

### `output.getData(col)`

Returns a [`ColumnData`](#columndata-arraycolumn-texturecolumn-glslcolumn-offsetcolumn) subclass instance for column `col`, extended with an additional `getArray()` method. Returns `null` if the column does not exist.

```javascript
const col = output.getData('hist.counts')
const arr = col.getArray()  // Float32Array — GPU readback if needed
```

The returned object is a full `ColumnData` instance — it also supports `col.length`, `col.domain`, `col.quantityKind`, `col.toTexture(regl)`, etc.

### `output.getData(col).getArray()`

Returns a `Float32Array` of the column's values on the CPU.

- For columns backed by a `Float32Array` (input data), returns the array directly with no GPU round-trip.
- For columns produced by a texture computation (transform outputs), reads the GPU texture back to CPU via a temporary framebuffer. The texture data is unpacked from the 4-values-per-texel RGBA format used internally.

### `output.getArrays()`

Reads all columns to CPU at once and returns a plain object:

```javascript
const arrays = output.getArrays()
// {
//   'input.depth':    Float32Array([...]),
//   'input.vp':       Float32Array([...]),
//   'hist.counts':    Float32Array([...]),
//   'hist.binCenters': Float32Array([...]),
// }
```

Columns that fail to read (e.g. uninitialized texture) are skipped with a `console.warn`; the rest are still returned.

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

The `Float` class is the generic draggable container used for both colorbars and filterbars. It is not instantiated directly — `Plot` creates and manages `Float` instances automatically via `_syncFloats()`. For details see [Colorbars and Filterbars](ColorbarsAndFilterbars.md#float).
