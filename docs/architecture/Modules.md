# Module Responsibilities

Detailed breakdown of each source module, organised by subdirectory. For the high-level picture see [ARCHITECTURE.md](../ARCHITECTURE.md). For data flow between modules see [DataFlow.md](DataFlow.md).

---

## `index.js`

**Purpose:** Single public API entry point.

**Public exports:**
- `Plot` — main plotting class
- `LayerType` — class for defining custom layer types
- `Layer` — data container DTO
- `Data` — data normalisation wrapper
- `Axis` — first-class axis object (obtained via `plot.axes[name]`)
- `linkAxes` — cross-plot axis linking
- `AXES` — array of the four spatial axis names
- `pointsLayerType` — built-in points `LayerType`
- `linesLayerType` — built-in lines `LayerType`
- `colorbarLayerType` — built-in 1D colorbar gradient `LayerType`
- `colorbar2dLayerType` — built-in 2D colorbar `LayerType`
- `filterbarLayerType` — built-in filterbar axis `LayerType`
- `tileLayerType`, `TileLayerType` — built-in map tile `LayerType`
- `Colorbar` — 1D colorbar plot (extends `Plot`)
- `Colorbar2d` — 2D colorbar plot (extends `Plot`)
- `Float` — draggable, resizable floating widget container
- `Filterbar` — filterbar plot (extends `Plot`)
- `registerLayerType`, `getLayerType`, `getRegisteredLayerTypes`
- `registerAxisQuantityKind`, `getAxisQuantityKind`, `getRegisteredAxisQuantityKinds`
- `registerColorscale`, `register2DColorscale`, `getRegisteredColorscales`, `getRegistered2DColorscales`, `getColorscaleIndex`, `get2DColorscaleIndex`, `buildColorGlsl`
- `buildFilterGlsl`
- `AxisRegistry`, `ColorAxisRegistry`, `FilterAxisRegistry`
- `registerEpsgDef`, `parseCrsCode`, `crsToQkX`, `crsToQkY`, `qkToEpsgCode`, `reproject`
- `Computation`, `TextureComputation`, `GlslComputation` — base classes for custom computations
- `registerTextureComputation`, `registerGlslComputation`, `isTexture`
- `EXPRESSION_REF`, `computationSchema`

---

## `core/` — Rendering Pipeline

### `core/Plot.js`

**Purpose:** Main rendering orchestrator.

**Key instance properties:**
```javascript
this.regl                // WebGL context (regl)
this.svg                 // D3 selection of the SVG overlay
this.layers              // Layer[]
this.axisRegistry        // AxisRegistry (spatial)
this.colorAxisRegistry   // ColorAxisRegistry
this.filterAxisRegistry  // FilterAxisRegistry
this._renderCallbacks    // Set<function> — called after each render()
```

**`update({ config, data })`** — Stores config/data, then calls `_initialize()` if both are present.

**`_initialize()`** — Rebuilds regl context, processes layers, sets domains, initialises zoom, renders.

**`_processLayers(layersConfig, data)`**
1. For each `{ typeName: parameters }`, looks up the `LayerType`
2. Calls `layerType.createLayer(parameters, data)` — resolves all axis quantities
3. Registers axes with `AxisRegistry`, `ColorAxisRegistry`, `FilterAxisRegistry`
4. Calls `layerType.createDrawCommand(regl, layer)` and stores the result

**`_setDomains(axesOverrides)`** — Computes auto-domains from layer data for spatial, color, and filter axes; applies any config overrides.

**`render()`** — Clears canvas; assembles props (current ranges, colorscale indices, filter ranges); calls all draw commands; renders axes via `Axis.render()`; fires `_renderCallbacks`.

**`static schema(data)`** — Aggregates JSON Schemas from all registered layer types.

**`static registerFloatFactory(type, { factory, defaultSize })`** — Registers a factory used by `_syncFloats()` to auto-create floating widgets. Called at module-load time by `Colorbar.js`, `Colorbar2d.js`, and `Filterbar.js`.

---

### `core/LayerType.js`

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
- Injects `normalize_axis()`, `map_color()`, and `filter_in_range()` GLSL helpers as needed

**`createLayer(parameters, data)`**
- Calls the user-supplied factory to get GPU config objects
- Calls `resolveAxisConfig()` to merge static declarations with `getAxisConfig()` output
- Constructs and returns ready-to-render `Layer` instances

**`resolveAxisConfig(parameters, data)`**
- Starts with static declarations as defaults
- Calls `getAxisConfig(parameters, data)` if present; dynamic non-`undefined` values override statics
- Returns fully resolved `{ xAxis, xAxisQuantityKind, yAxis, yAxisQuantityKind, colorAxisQuantityKinds, filterAxisQuantityKinds }`

**`schema(data)`** — Returns JSON Schema (Draft 2020-12) for layer parameters.

---

### `core/Layer.js`

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

### `core/Data.js`

**Purpose:** Normalise plain data objects of several formats into a consistent columnar interface.

**`Data.wrap(data)`** — Returns `data` unchanged if it already has `columns` and `getData` methods; otherwise wraps the plain object, auto-detecting the format.

**Supported formats:** simple flat `Float32Array` map; per-column rich objects with `{ data, quantity_kind, domain }`; columnar format with parallel `data`, `quantity_kinds`, `domains` sub-objects.

**Key methods:** `columns()`, `getData(col)`, `getQuantityKind(col)`, `getDomain(col)`.

---

### `core/LayerTypeRegistry.js`

**Purpose:** Global registry for `LayerType` instances.

**Pattern:** Registry

**Responsibilities:**
- Store `LayerType` instances by name in a `Map`
- Prevent duplicate registrations (throws on collision)
- Throw with a helpful listing if an unregistered name is requested

**API:** `registerLayerType(name, layerType)`, `getLayerType(name)`, `getRegisteredLayerTypes()`

---

## `axes/` — Axis System

### `axes/Axis.js`

**Purpose:** First-class axis object. Stable across `update()` calls; safe to hold references to.

**Pattern:** Observer (subscribe/notify)

**Key behaviour:**
- `getDomain()` / `setDomain(domain)` — read and write the axis range on the owning plot
- `subscribe(callback)` / `unsubscribe(callback)` — register for domain-change notifications
- Re-entrancy guard prevents infinite loops when axes are linked bidirectionally
- Works for spatial axes (e.g. `"xaxis_bottom"`), color axes, and filter axes via a unified `Plot.getAxisDomain` / `Plot.setAxisDomain` interface
- `render()` — renders the D3 axis ticks and label into the SVG (no-op for non-spatial axes)

Obtained via `plot.axes[axisName]`.

---

### `axes/AxisRegistry.js`

**Purpose:** Centralised D3 scale management with quantity kind validation.

**Pattern:** Registry with lazy initialisation

**Key data structures:**
```javascript
this.scales = {}            // { axisName: D3Scale }
this.axisQuantityKinds = {} // { axisName: quantityKind }
```

**`ensureAxis(name, quantityKind, scaleOverride)`**
- Creates a D3 scale (linear or log) if the axis doesn't exist yet
- Throws if the axis already exists with a different quantity kind

**`applyAutoDomainsFromLayers(layers, axesOverrides)`** — Scans all layers to compute per-axis min/max; applies config overrides; validates log-scale domains.

**Exports `AXES`** — the four canonical spatial axis names: `["xaxis_bottom", "xaxis_top", "yaxis_left", "yaxis_right"]`.

---

### `axes/AxisLink.js`

**Purpose:** Cross-plot axis linking.

**`linkAxes(axis1, axis2)`** — Subscribes each axis to the other. When either calls `setDomain`, the other is updated. Returns `{ unlink() }` to remove the bidirectional link.

Accepts any object implementing the `Axis` interface (duck typing), not just `Axis` instances.

---

### `axes/AxisQuantityKindRegistry.js`

**Purpose:** Global registry of quantity kind definitions.

**`registerAxisQuantityKind(name, definition)`** — Registers or merges a definition `{ label, scale, colorscale }` for a quantity kind string.

**`getAxisQuantityKind(name)`** — Returns the definition, falling back to `{ label: name, scale: "linear" }` for unknown names.

**`getRegisteredAxisQuantityKinds()`** — Returns an array of all registered names.

**`getScaleTypeFloat(quantityKind, axesConfig)`** — Returns `1.0` for log scale, `0.0` for linear; reads from `axesConfig` with fallback to the registered definition.

---

### `axes/ColorAxisRegistry.js`

**Purpose:** Track color axis quantity kinds, ranges, and colorscale preferences. Internal — managed by `Plot`.

**`ensureColorAxis(quantityKind, colorscaleOverride?)`** — Registers a quantity kind if not already present; applies a colorscale override if given.

**`setRange(quantityKind, min, max)`** — Stores the resolved range.

**`getColorscale(quantityKind)`** — Returns the active colorscale name (override → quantity kind registry → null).

**`getColorscaleIndex(quantityKind)`** — Returns the integer colorscale index used as a GLSL uniform.

**`applyAutoDomainsFromLayers(layers, axesOverrides)`** — Scans layer data for auto-range; applies config overrides; validates log-scale ranges.

---

### `axes/FilterAxisRegistry.js`

**Purpose:** Track filter axis quantity kinds and their active ranges. Internal — managed by `Plot`.

**`ensureFilterAxis(quantityKind)`** — Registers a quantity kind with open bounds (`null` min and max).

**`setRange(quantityKind, min, max)`** — Sets one or both bounds (each independently nullable for open bounds).

**`getRangeUniform(quantityKind)`** — Returns `[min, max, hasMin, hasMax]` for use as a GLSL `vec4` uniform.

**`getDataExtent(quantityKind)`** — Returns `[min, max]` of the raw data (used by `Filterbar` to set the visible range when a bound is open).

**`buildFilterGlsl()`** (module-level export) — Returns the `filter_in_range(vec4 range, float value)` GLSL helper string.

---

### `axes/ZoomController.js`

**Purpose:** Handles zoom and pan interactions.

Attached to the plot SVG during `_initialize()`. Detects which region the gesture starts in (plot area, or an individual axis margin) and updates only the relevant D3 scales. Uses cursor-anchored zoom: the data value under the cursor stays fixed as the scale is expanded/contracted. Works in log space for log-scale axes.

---

## `colorscales/` — Color Management

### `colorscales/ColorscaleRegistry.js`

**Purpose:** Store GLSL colorscale functions and build the dispatch code.

**`registerColorscale(name, glslFn)`** — Adds a named 1D GLSL function (`vec4 colorscale_NAME(float t)`).

**`register2DColorscale(name, glslFn)`** — Adds a named 2D GLSL function (`vec4 colorscale_2d_NAME(vec2 t)`).

**`buildColorGlsl()`** — Returns all colorscale functions concatenated with dispatch helpers:
- `map_color(int cs, vec2 range, float value)` — 1D dispatch
- `map_color_s(int cs, vec2 range, float v, float scaleType, float useAlpha)` — with log scale and alpha
- `map_color_s_2d(int cs_a, ..., int cs_b, ...)` — blends two 1D colorscales, or dispatches to a true 2D colorscale when both sides share the same negative index

**`getColorscaleIndex(name)`** — 1D colorscales return non-negative indices; 2D colorscales return negative indices (`-(idx+1)`), which is the signal for `map_color_s_2d` to use the true 2D path.

---

### `colorscales/MatplotlibColorscales.js`

**Purpose:** Pre-register all standard matplotlib 1D colorscales (viridis, plasma, inferno, magma, Spectral, coolwarm, Blues, and many more).

Imported by `index.js` as a side-effect so all colorscales are available immediately on library import, without any explicit registration call from user code.

---

### `colorscales/BivariateColorscales.js`

**Purpose:** Pre-register 2D colorscales (bilinear 4-corner, HSV phase-magnitude, diverging×diverging, etc.).

Imported by `index.js` as a side-effect alongside `MatplotlibColorscales.js`.

---

## `layers/` — Layer Type Implementations

### `layers/ScatterShared.js`

**Purpose:** Base class `ScatterLayerTypeBase` with shared logic for `PointsLayer` and `LinesLayer`.

**Shared methods:**
- `_getAxisConfig(parameters, data)` — resolves spatial and color axis quantity kinds from column metadata
- `_commonSchemaProperties(dataProperties)` — returns JSON Schema properties common to both layer types (`xData`, `yData`, `vData`, `vData2`, `xAxis`, `yAxis`, `alphaBlend`)
- `_resolveColorData(parameters, d)` — strips `"none"` sentinels, validates columns exist, returns resolved data arrays and quantity kinds
- `_buildDomains(...)` — constructs the `domains` object from data metadata
- `_buildNameMap(...)` — constructs the `nameMap` that renames per-quantity-kind uniforms to fixed shader names
- `_buildBlendConfig(alphaBlend)` — returns a regl blend config or `null`

---

### `layers/PointsLayer.js`

**Purpose:** Built-in `points` `LayerType` — renders data as individual GL points.

- Registered as `"points"`
- Point size: 4.0 px
- Supports optional second color data (`vData2`) for 2D colorscale mapping
- **Schema parameters:** `xData`, `yData`, `vData` (required); `vData2`, `xAxis`, `yAxis`, `alphaBlend` (optional)

---

### `layers/LinesLayer.js`

**Purpose:** Built-in `lines` `LayerType` — renders data as connected line segments using instanced rendering.

- Registered as `"lines"`
- One instance per segment (N−1 instances for N points); two-vertex template
- Segment boundary collapses: when `a_seg0 ≠ a_seg1`, produces a zero-length degenerate line
- **Schema parameters:** `xData`, `yData`, `vData` (required); `vData2`, `xAxis`, `yAxis`, `alphaBlend`, `lineSegmentIdData`, `lineColorMode`, `lineWidth` (optional)

---

### `layers/ColorbarLayer.js`

**Purpose:** `LayerType` that renders a 1D gradient quad for a colorbar.

Uses a triangle-strip primitive to fill the entire canvas with a color gradient. Supports `orientation` (`"horizontal"` or `"vertical"`). Auto-registered as `"colorbar"` on import. Typically used internally by `Colorbar.js`.

---

### `layers/ColorbarLayer2d.js`

**Purpose:** `LayerType` that renders a 2D colorbar quad, mapping both x and y position to separate color axes.

Uses the same triangle-strip quad as `ColorbarLayer`. Each fragment's `(tval_x, tval_y)` position is converted to data values in each color axis's range and passed to `map_color_s_2d`. Auto-registered as `"colorbar2d"` on import. Typically used internally by `Colorbar2d.js`.

---

### `layers/FilterbarLayer.js`

**Purpose:** `LayerType` that registers a filter axis without rendering any geometry.

Binds the filter axis quantity kind to a spatial axis so tick labels show the filter range. Always returns `vertexCount: 0` — the draw call is a no-op. Auto-registered as `"filterbar"` on import.

---

### `layers/TileLayer.js`

**Purpose:** Built-in `tile` `LayerType` — renders map tiles from XYZ, WMS, or WMTS sources with optional reprojection.

**Key internals:**
- `TileManager` — computes needed tiles for the current viewport, fetches images, maintains an LRU cache, triggers re-renders on load
- `buildTileMesh` — tessellates each tile into an N×N quad grid with proj4 reprojection applied per vertex
- Zoom level is chosen automatically to match pixel resolution
- CRS definitions are fetched from `epsg.io` on demand via `EpsgUtils.ensureCrsDefined`

Auto-registered as `"tile"` on import. Also exports the `TileLayerType` class for subclassing.

---

## `floats/` — Floating Widgets

### `floats/Float.js`

**Purpose:** Draggable, resizable floating container that wraps any plot-like widget.

Creates an absolutely-positioned `<div>` inside the parent plot's container with a thin drag bar at the top and a resize handle at the bottom-right. The content area below the drag bar is filled by calling the user-supplied `factory(contentElement)`, which must return an object with a `destroy()` method. Used by `Plot._syncFloats()` to host `Colorbar`, `Colorbar2d`, and `Filterbar` instances.

---

### `floats/Colorbar.js`

**Purpose:** 1D colorbar plot (extends `Plot`).

Overrides `render()` to read the current range, colorscale, and scale type from the target plot's `ColorAxisRegistry`, then delegates to `super.render()`. Links its spatial axis bidirectionally to the target's color axis so zoom/pan propagates. Registers itself in the target's `_renderCallbacks` so it redraws automatically on every main-plot render.

At module load, registers a `'colorbar'` float factory with `Plot.registerFloatFactory` so `_syncFloats()` can auto-create instances from `config.axes[qk].colorbar` declarations.

---

### `floats/Colorbar2d.js`

**Purpose:** 2D colorbar plot (extends `Plot`).

Like `Colorbar`, but syncs two color axes (`xAxis` and `yAxis`) to the target's `ColorAxisRegistry` and links both spatial axes bidirectionally. Uses `colorbar2d` as its layer type.

At module load, registers a `'colorbar2d'` float factory with `Plot.registerFloatFactory` so `_syncFloats()` can auto-create instances from `config.colorbars` entries that specify both `xAxis` and `yAxis`.

---

### `floats/Filterbar.js`

**Purpose:** Filterbar plot (extends `Plot`) for interactively controlling a filter axis range.

Overrides `render()` to read the current filter range from the target's `FilterAxisRegistry`, update the spatial axis domain, and sync ∞ checkbox states. Links its spatial axis bidirectionally to the target's filter axis. Adds two checkbox overlays at the edges that toggle open bounds (null min / null max) on the target filter axis.

At module load, registers a `'filterbar'` float factory with `Plot.registerFloatFactory` so `_syncFloats()` can auto-create instances from `config.axes[qk].filterbar` declarations.

---

## `geo/` — Geographic Utilities

### `geo/EpsgUtils.js`

**Purpose:** EPSG/CRS handling for the map tile layer.

**`parseCrsCode(crs)`** — Parses `"EPSG:26911"`, `"26911"`, or `26911` to an integer code.

**`crsToQkX(crs)` / `crsToQkY(crs)`** — Convert a CRS string to the corresponding quantity kind strings (`"epsg_26911_x"` / `"epsg_26911_y"`). Used by `TileLayer` to auto-register axis quantity kinds.

**`qkToEpsgCode(qk)`** — Reverse: parses `"epsg_26911_x"` back to `26911`.

**`registerEpsgDef(epsgCode, proj4string)`** — Pre-registers a proj4 definition for offline use, and registers the matching quantity kinds.

**`ensureCrsDefined(crs)`** — Ensures a CRS is defined in proj4 and has quantity kinds registered. If not already known, fetches the proj4 string from `epsg.io` (async). Concurrent calls for the same code share one in-flight request.

**`reproject(fromCrs, toCrs, point)`** — Reprojects a `[x, y]` point between two CRS codes using proj4.

---

## `compute/` — Computed Attributes

The `compute/` directory implements the **computed attribute system**: a class-based registry of named computations that can produce GPU textures or GLSL expressions for use as layer attributes.

---

### `compute/ComputationRegistry.js`

**Purpose:** Central hub for the computed attribute system.

**Pattern:** Registry + Strategy

**Base classes:**
- `Computation` — abstract base; subclasses must implement `schema(data) => JSONSchema`
- `TextureComputation extends Computation` — subclasses must implement `compute(regl, params, getAxisDomain) => Texture`
- `GlslComputation extends Computation` — subclasses must implement `glsl(resolvedGlslParams) => string`

**Registry functions:**
- `registerTextureComputation(name, computation)` — stores a `TextureComputation` instance under `name`
- `registerGlslComputation(name, computation)` — stores a `GlslComputation` instance under `name`

**Schema support:**
- `EXPRESSION_REF` — `{ '$ref': '#/$defs/expression' }` constant; use in `schema()` for params that accept a `Float32Array` or a nested computation expression
- `computationSchema(data)` — builds a JSON Schema Draft 2020-12 document with `$defs` for every registered computation's params plus a recursive `expression` entry (`anyOf` of column names and all computation forms)

**Attribute resolution:**
- `resolveAttributeExpr(regl, expr, attrShaderName, plot)` — entry point called by `LayerType.createDrawCommand`; returns `{ kind: 'buffer', value }` for plain `Float32Array`, or `{ kind: 'computed', glslExpr, context }` for computation expressions. The `context` carries `bufferAttrs`, `textureUniforms`, `scalarUniforms`, `globalDecls`, and `axisUpdaters` for shader injection.
- `isTexture(value)` — duck-type check for regl textures; useful inside `compute()` when a param may be either a `Float32Array` or an already-computed texture.

**Axis-reactive recomputation:** when a texture computation calls `getAxisDomain(axisId)`, the registry registers that axis as a dependency and stores an updater in `context.axisUpdaters`. On each render, `Plot` calls `refreshIfNeeded()` on all updaters; if any tracked axis domain has changed the texture is recomputed transparently.

---

### Built-in Computation Files

Each file defines one or more `TextureComputation` subclasses and registers them as side-effects. All are imported by `index.js`.

| File | Registered name(s) | Description |
|------|--------------------|-------------|
| `compute/hist.js` | `histogram` | Bins normalised values into a histogram texture (CPU or GPU path; auto-selects bin count via Scott's rule) |
| `compute/axisFilter.js` | `filteredHistogram` | Like `histogram` but filters input by a filter axis range before counting; axis-reactive |
| `compute/kde.js` | `kde` | Gaussian-smoothed kernel density estimate over a histogram or raw array |
| `compute/filter.js` | `filter1D`, `lowPass`, `highPass`, `bandPass` | 1-D GPU convolution; Gaussian low/high/band-pass variants built on top |
| `compute/fft.js` | `fft1d`, `fftConvolution` | GPU Cooley–Tukey FFT of a real signal; FFT-based convolution |
| `compute/conv.js` | `convolution` | Adaptive convolution: single-pass GPU (kernel ≤ 1024), chunked GPU (≤ 8192), or FFT fallback |

See [Computed Attributes](../api/ComputedAttributes.md) for usage, parameter schemas, and extension examples.
