# Module Responsibilities

Detailed breakdown of each source module. For the high-level picture see [ARCHITECTURE.md](../ARCHITECTURE.md). For data flow between modules see [DataFlow.md](DataFlow.md).

---

## `index.js`

**Purpose:** Single public API entry point.

**Public exports:**
- `Plot` — main plotting class
- `LayerType` — class for defining custom layer types
- `Axis` — first-class axis object (obtained via `plot.axes[name]`)
- `linkAxes` — cross-plot axis linking
- `scatterLayerType` — built-in scatter `LayerType`
- `colorbarLayerType` — built-in colorbar gradient `LayerType`
- `filterbarLayerType` — built-in filterbar axis `LayerType`
- `Colorbar` — colorbar plot (extends `Plot`)
- `Float` — draggable floating colorbar widget
- `Filterbar` — filterbar plot (extends `Plot`)
- `FilterbarFloat` — draggable floating filterbar widget
- `registerLayerType`, `getLayerType`, `getRegisteredLayerTypes`
- `registerAxisQuantityKind`, `getAxisQuantityKind`, `getRegisteredAxisQuantityKinds`
- `registerColorscale`, `getRegisteredColorscales`, `buildColorGlsl`
- `buildFilterGlsl`
- `AXES`

**Internal exports** (available for advanced use, not part of the stable public API):
- `Layer` — data container DTO
- `AxisRegistry` — spatial scale management
- `ColorAxisRegistry` — color axis range + colorscale management
- `FilterAxisRegistry` — filter axis range management

---

## `LayerTypeRegistry.js`

**Purpose:** Global registry for `LayerType` instances.

**Pattern:** Registry

**Responsibilities:**
- Store `LayerType` instances by name in a `Map`
- Prevent duplicate registrations (throws on collision)
- Throw with a helpful listing if an unregistered name is requested

**API:** `registerLayerType(name, layerType)`, `getLayerType(name)`, `getRegisteredLayerTypes()`

---

## `LayerType.js`

**Purpose:** Encapsulate a rendering strategy with schema and factory.

**Pattern:** Strategy + Factory

**Key properties:**
```javascript
{
  name: string,
  // Optional static axis declarations (readable without parameters/data — for introspection)
  xAxis: string|undefined,               // default x-axis position
  xAxisQuantityKind: string|undefined,
  yAxis: string|undefined,               // default y-axis position
  yAxisQuantityKind: string|undefined,
  colorAxisQuantityKinds: string[],      // static quantity kinds for color axes
  filterAxisQuantityKinds: string[],     // static quantity kinds for filter axes
  vert: string,        // GLSL vertex shader
  frag: string,        // GLSL fragment shader
  schema: (data) => JSONSchema,
  createLayer: (parameters, data) => Array<{ attributes, uniforms, primitive?, vertexCount?, nameMap? }>,
  getAxisConfig: (parameters, data) => axisConfig,  // optional dynamic resolver
}
```

**`createDrawCommand(regl, layer)`**
- Applies `layer.nameMap` to rename attribute and uniform keys to shader-visible names
- Compiles shaders into a regl draw command
- Adds standard uniforms: `xDomain`, `yDomain`, `count`
- Adds `colorscale_<quantityKind>` + `color_range_<quantityKind>` for each color axis
- Adds `filter_range_<quantityKind>` (vec4) for each filter axis
- Injects `map_color()` GLSL helper when color axes are present
- Injects `filter_in_range()` GLSL helper when filter axes are present
- Dynamically builds `attributes` and `uniforms` maps from the layer instance

**`createLayer(parameters, data)`**
- Calls the user-supplied factory to get an array of `{ attributes, uniforms, primitive?, vertexCount?, nameMap? }`
- Calls `resolveAxisConfig()` to merge static declarations with `getAxisConfig()` output
- Constructs and returns a ready-to-render Layer

**`resolveAxisConfig(parameters, data)`**
- Starts with static declarations as defaults
- Calls `getAxisConfig(parameters, data)` if present; dynamic non-`undefined` values override statics
- Returns fully resolved `{ xAxis, xAxisQuantityKind, yAxis, yAxisQuantityKind, colorAxisQuantityKinds, filterAxisQuantityKinds }`

**`schema(data)`** — Returns JSON Schema (Draft 2020-12) for layer parameters.

---

## `Layer.js`

**Purpose:** Lightweight data container (DTO).

**Pattern:** Data Transfer Object

**Constructor validation:**
- All `attributes` values must be `Float32Array` — throws `TypeError` otherwise
- `colorAxes` must be `string[]` — each element is a quantity kind
- `filterAxes` must be `string[]` — each element is a quantity kind

**Why Float32Array?**
- Direct GPU memory mapping — no conversion overhead
- Matches GLSL `mediump float` / `highp float` precision
- Compact: 4 bytes per value

---

## `ScatterLayer.js`

**Purpose:** Built-in scatter plot `LayerType` implementation.

**Configuration:**
- Spatial quantity kinds: dynamic (`x` ← `xData` name, `y` ← `yData` name)
- Color axis quantity kind ← `vData` name; colorscale from quantity kind registry
- Point size: 4.0 px
- Uses `nameMap` to bind the dynamic color axis quantity kind to fixed shader names (`color_data`, `colorscale`, `color_range`, `color_scale_type`)

**Vertex shader:** Normalises `(x, y)` from data coordinates to clip space `[-1, 1]` using `xDomain`/`yDomain` uniforms; passes the color attribute (`vData`) as a varying.

**Fragment shader:** Calls `map_color(colorscale_<vData>, color_range_<vData>, value)` to produce RGBA.

**Schema parameters:** `xData`, `yData`, `vData` (required); `xAxis`, `yAxis` (optional).

---

## `Plot.js`

**Purpose:** Main rendering orchestrator.

**Key instance properties:**
```javascript
this.regl                // WebGL context (regl)
this.svg                 // D3 selection of the SVG overlay
this.layers              // Layer[]
this.drawCommands        // regl draw functions, one per layer
this.axisRegistry        // AxisRegistry (spatial)
this.colorAxisRegistry   // ColorAxisRegistry
this.filterAxisRegistry  // FilterAxisRegistry
this._renderCallbacks    // Set<function> — called after each render()
```

**`update({ config, data })`** — Stores config/data, then calls `_initialize()` if both are present.

**`_initialize()`** — Rebuilds regl context, processes layers, sets ranges, initialises zoom, renders.

**`_processLayers(layersConfig, data)`**
1. For each `{ typeName: parameters }`, looks up the `LayerType`
2. Calls `layerType.createLayer(parameters, data)` — resolves all axis quantities
3. Registers axes with `AxisRegistry`, `ColorAxisRegistry`, `FilterAxisRegistry`
4. Calls `layerType.createDrawCommand(regl, layer)` and stores the result

**`_setDomains(axesOverrides)`**
- Spatial: collects `attributes.x`/`attributes.y` data per axis, computes min/max range, applies config override
- Color: scans all layers; for each color axis quantity kind reads `layer.attributes[quantityKind]` for auto-range (skipped when attribute absent, e.g. ColorbarLayer); applies config override
- Filter: same pattern for filter axes; applies config `min`/`max` if present, defaults to open bounds

**`render()`** — Clears canvas; assembles props (current ranges, colorscale indices, filter ranges); calls all draw commands; calls `renderAxes()`; fires `_renderCallbacks`.

**`renderAxes()`** — For each axis in the registry, creates a D3 axis generator, renders to an SVG `<g>`, adds a unit label.

**`initZoom()`** — Creates a full-coverage SVG rectangle; attaches a D3 zoom behaviour with region detection (plot area vs. individual axis); updates scale domains on each event; calls `render()`.

**`static schema()`** — Aggregates JSON Schemas from all registered layer types.

---

## `AxisRegistry.js`

**Purpose:** Centralised D3 scale management with quantity kind validation.

**Pattern:** Registry with lazy initialisation

**Key data structures:**
```javascript
this.scales = {}   // { axisName: D3Scale }
this.units  = {}   // { axisName: quantityKind }
```

**`ensureAxis(name, quantityKind)`**
- Creates a D3 scale (linear or log, based on quantity kind) if the axis doesn't exist yet
- Maps axis position to pixel range:
  - `xaxis_bottom` / `xaxis_top` → `[0, width]`
  - `yaxis_left` / `yaxis_right` → `[height, 0]` (inverted for canvas coords)
- Throws if the axis already exists with a different quantity kind

---

## `Axis.js`

**Purpose:** First-class axis object. Stable across `update()` calls; safe to hold references to.

**Pattern:** Observer (subscribe/notify)

**Key behaviour:**
- `getDomain()` / `setDomain(domain)` — read and write the axis range on the owning plot
- `subscribe(callback)` / `unsubscribe(callback)` — register for domain-change notifications
- Re-entrancy guard prevents infinite loops when axes are linked bidirectionally
- Works for spatial axes (e.g. `"xaxis_bottom"`), color axes, and filter axes via a unified `Plot.getAxisDomain` / `Plot.setAxisDomain` interface

Obtained via `plot.axes[axisName]`.

---

## `AxisLink.js`

**Purpose:** Cross-plot axis linking.

**`linkAxes(axis1, axis2)`** — Subscribes each axis to the other. When either calls `setDomain`, the other is updated. Returns `{ unlink() }` to remove the bidirectional link.

Accepts any object implementing the `Axis` interface (duck typing), not just `Axis` instances.

---

## `AxisQuantityKindRegistry.js`

**Purpose:** Global registry of quantity kind definitions.

**`registerAxisQuantityKind(name, definition)`** — Registers or merges a definition `{ label, scale, colorscale }` for a quantity kind string.

**`getAxisQuantityKind(name)`** — Returns the definition, falling back to `{ label: name, scale: "linear" }` for unknown names.

**`getRegisteredAxisQuantityKinds()`** — Returns an array of all registered names.

---

## `ColorAxisRegistry.js`

**Purpose:** Track color axis quantity kinds, ranges, and colorscale preferences. Internal — managed by `Plot`.

**`ensureColorAxis(quantityKind)`** — Registers a quantity kind if not already present.

**`setRange(quantityKind, min, max)`** — Stores the resolved range.

**`setColorscale(quantityKind, name)`** — Stores the colorscale preference.

**`getColorscaleIndex(quantityKind)`** — Returns the integer colorscale index used as a GLSL uniform.

---

## `FilterAxisRegistry.js`

**Purpose:** Track filter axis quantity kinds and their active ranges. Internal — managed by `Plot`.

**`ensureFilterAxis(quantityKind)`** — Registers a quantity kind with open bounds.

**`setRange(quantityKind, min, max)`** — Sets one or both bounds (each independently optional).

**`getRangeUniform(quantityKind)`** — Returns `[min, max, hasMin, hasMax]` for use as a GLSL `vec4` uniform.

**`buildFilterGlsl()`** (exported from `FilterAxisRegistry.js`) — Returns the `filter_in_range` GLSL helper string.

---

## `ColorscaleRegistry.js`

**Purpose:** Store GLSL colorscale functions and build the dispatch code.

**`registerColorscale(name, glslFn)`** — Adds a named GLSL function.

**`buildColorGlsl()`** — Returns all colorscale functions concatenated with two dispatchers: `map_color(int cs, vec2 range, float value)` (linear) and `map_color_s(int cs, vec2 range, float value, float scaleType)` (handles log scale). Injected by `LayerType.createDrawCommand` when color axes are present.

---

## `MatplotlibColorscales.js`

**Purpose:** Pre-register all standard matplotlib colorscales.

Imported by `index.js` as a side-effect so all colorscales are available immediately on library import, without any explicit registration call from user code.

---

## `Colorbar.js`

**Purpose:** Specialised plot for rendering a color legend.

Extends `Plot`. Overrides `render()` to read the current range, colorscale, and scale type from a target plot's color axis registry, then delegates to `super.render()`. Registers itself in the target plot's `_renderCallbacks` so it redraws automatically whenever the main plot updates. Links its spatial axis bidirectionally to the target's color axis so zoom/pan propagates.

---

## `ColorbarLayer.js`

**Purpose:** `LayerType` that renders a gradient quad for a colorbar.

Uses a triangle-strip primitive (`cx = [-1,1,-1,1]`, `cy = [-1,-1,1,1]`, `primitive = "triangle strip"`, `vertexCount = 4`) to fill the entire canvas with a color gradient. Supports `orientation` (`"horizontal"` or `"vertical"`). Auto-registered as `"colorbar"` on import.

---

## `Float.js`

**Purpose:** Draggable, resizable floating colorbar widget.

Wraps a `Colorbar` in an absolutely-positioned `<div>` inside the parent plot's container. A thin drag bar at the top is the only draggable handle; the `Colorbar` sub-container below it receives pointer events normally so zoom/pan on the colorbar still works. Sets `Plot._FloatClass = Float` on import so `Plot._syncFloats()` can instantiate it without a direct import dependency.

---

## `Filterbar.js`

**Purpose:** Specialised plot for interactively controlling a filter axis range.

Extends `Plot`. Overrides `render()` to read the current filter range from the target plot's filter axis registry, update the spatial axis domain, and sync the ∞ checkbox states. Links its spatial axis bidirectionally to the target's filter axis. Adds two checkbox overlays at the edges of the plot that toggle open bounds (null min / null max) on the target filter axis.

---

## `FilterbarLayer.js`

**Purpose:** `LayerType` that registers a filter axis without rendering any geometry.

Binds the filter axis quantity kind to a spatial axis so tick labels show the filter range. Always returns `vertexCount: 0` — the draw call is a no-op. Auto-registered as `"filterbar"` on import.

---

## `FilterbarFloat.js`

**Purpose:** Draggable, resizable floating filterbar widget.

Mirrors `Float.js` but wraps a `Filterbar` instead of a `Colorbar`. Sets `Plot._FilterbarFloatClass = FilterbarFloat` on import so `Plot._syncFloats()` can instantiate it without a direct import dependency.
