# Gladly Architecture Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library built on WebGL (via regl) and D3.js. The architecture is designed around a **declarative API** with clean separation between GPU-based data rendering and DOM-based axis/interaction management.

**Key Architectural Principles:**
- Declarative plot configuration — specify what to render, not how
- GPU rendering for data points (WebGL canvas) + SVG overlay for axes
- Layer type registry for extensibility without modifying core code
- Auto range calculation from data, with opt-in overrides
- Multi-axis system with quantity kind enforcement to prevent incompatible layer combinations
- Strategy pattern: each layer type encapsulates its own shaders and schema

---

## Architecture sub-topics

- **[Module Responsibilities](architecture/Modules.md)** — per-module purpose, patterns, key properties and methods
- **[Data Flow & Rendering](architecture/DataFlow.md)** — declarative setup, render cycle, zoom/pan interaction

## User-facing documentation

- **[API Overview & Data Model](API.md)** — concepts, data model, documentation map
- **[Configuring Plots](api/PlotConfiguration.md)** — `plot.update()`, axes, auto-range, interaction
- **[Writing Layer Types](api/LayerTypes.md)** — shaders, axis declarations, GLSL helpers
- **[Computed Attributes](api/ComputedAttributes.md)** — texture and GLSL computations
- **[API Reference](api/Reference.md)** — complete public API signatures

---

## Project Structure

```
gladly/
├── src/
│   ├── index.js                               # Public API exports
│   ├── core/
│   │   ├── Plot.js                            # Main rendering orchestrator
│   │   ├── Layer.js                           # Data container (DTO)
│   │   ├── LayerType.js                       # Shader + metadata + schema + factory
│   │   ├── Data.js                            # Data normalisation wrapper
│   │   └── LayerTypeRegistry.js               # Global layer type registration
│   ├── axes/
│   │   ├── Axis.js                            # First-class axis object (stable across update())
│   │   ├── AxisRegistry.js                    # Spatial scale management (internal)
│   │   ├── AxisLink.js                        # Cross-plot axis linking
│   │   ├── AxisQuantityKindRegistry.js        # Global quantity kind definitions
│   │   ├── ColorAxisRegistry.js               # Color axis range + colorscale management (internal)
│   │   ├── FilterAxisRegistry.js              # Filter axis range management + GLSL helper (internal)
│   │   └── ZoomController.js                  # Zoom and pan interaction
│   ├── colorscales/
│   │   ├── ColorscaleRegistry.js              # GLSL colorscale registration + dispatch builder
│   │   ├── MatplotlibColorscales.js           # All matplotlib 1D colorscales pre-registered
│   │   └── BivariateColorscales.js            # 2D colorscales pre-registered
│   ├── layers/
│   │   ├── ScatterShared.js                   # Shared base class for points/lines layer types
│   │   ├── PointsLayer.js                     # Built-in points LayerType
│   │   ├── LinesLayer.js                      # Built-in lines LayerType
│   │   ├── ColorbarLayer.js                   # Built-in 1D colorbar gradient LayerType
│   │   ├── ColorbarLayer2d.js                 # Built-in 2D colorbar LayerType
│   │   ├── FilterbarLayer.js                  # Built-in filterbar axis LayerType
│   │   └── TileLayer.js                       # Built-in map tile LayerType (XYZ/WMS/WMTS)
│   ├── floats/
│   │   ├── Float.js                           # Draggable, resizable floating widget container
│   │   ├── Colorbar.js                        # 1D colorbar plot (extends Plot)
│   │   ├── Colorbar2d.js                      # 2D colorbar plot (extends Plot)
│   │   └── Filterbar.js                       # Filterbar plot (extends Plot)
│   ├── geo/
│   │   └── EpsgUtils.js                       # EPSG/CRS projection utilities
│   └── compute/
│       ├── ComputationRegistry.js             # Base classes, registry, schema, attribute resolver
│       ├── hist.js                            # 'histogram' TextureComputation
│       ├── axisFilter.js                      # 'filteredHistogram' TextureComputation
│       ├── kde.js                             # 'kde' TextureComputation
│       ├── filter.js                          # 'filter1D', 'lowPass', 'highPass', 'bandPass' TextureComputations
│       ├── fft.js                             # 'fft1d', 'fftConvolution' TextureComputations
│       └── conv.js                            # 'convolution' TextureComputation
├── example/
│   ├── main.js                                # Example usage
│   └── index.html                             # Demo page
├── package.json
└── docs/
    ├── API.md                                 # User-facing API overview
    ├── ARCHITECTURE.md                        # This file
    ├── Quickstart.md                          # Installation and minimal example
    ├── api/
    │   ├── PlotConfiguration.md               # How to configure plots
    │   ├── LayerTypes.md                      # How to write layer types
    │   ├── BuiltInLayerTypes.md               # points, lines, tile, colorbar, filterbar layer types
    │   ├── ColorbarsAndFilterbars.md          # Colorbar, Colorbar2d, Filterbar, Float
    │   └── Reference.md                       # Full public API reference
    └── architecture/
        ├── Modules.md                         # Detailed module responsibilities
        └── DataFlow.md                        # Data flow and rendering pipeline
```

---

## Component Dependency Graph

```
Plot (main orchestrator)
  ├── regl (WebGL context)
  ├── D3 (selection, scales, axes, zoom)
  ├── AxisRegistry (created internally — spatial axes)
  │   └── D3 scales (linear / log)
  ├── ColorAxisRegistry (created internally — color axes)
  ├── FilterAxisRegistry (created internally — filter axes)
  ├── LayerTypeRegistry (global singleton)
  │   └── LayerType instances (by name)
  └── Layer[] (created automatically from config)
      └── LayerType (rendering strategy)
```

---

## Design Patterns

### 1. Declarative Configuration

**Intent:** Specify what to render, not how.

Users pass a `config` object with layer specifications and optional range overrides. The Plot interprets this to build and render layers automatically. The configuration is serialisable JSON (data arrays aside).

**Benefits:** Concise plot creation; easy serialisation; self-documenting via JSON Schema.

---

### 2. Registry Pattern — Layer Types

**Intent:** Maintain a global registry so layers can be referenced by name in config.

`LayerTypeRegistry` stores `LayerType` instances by name. Users register once at startup; the Plot looks up types by name during `update()`. `Plot.schema()` aggregates schemas from all registered types.

**Benefits:** Decouples type definition from plot creation; enables schema generation and tooling.

---

### 3. Strategy Pattern — LayerType

**Intent:** Define a family of rendering algorithms and make them interchangeable.

Each `LayerType` encapsulates shaders, axis quantity kinds, schema, and a factory. The Plot calls a uniform interface regardless of layer type. New types can be added without modifying `Plot`.

**Benefits:** Easy extensibility; type-specific shader code isolated; type-specific validation.

---

### 4. Registry Pattern — Computation Types

**Intent:** Make named computations discoverable for both execution and schema introspection.

`ComputationRegistry` stores `TextureComputation` and `GlslComputation` instances by name. Any computation expression `{ name: params }` in an `attributes` map is resolved through this registry at draw-command build time. `computationSchema(data)` aggregates `schema(data)` from all registered computations into a single JSON Schema document with `$defs`-based recursion.

**Benefits:** Custom computations plug in without modifying core code; schema generation for all computations is automatic; expressions can nest arbitrarily via `EXPRESSION_REF`.

---

### 5. Factory Pattern — Layer Creation

**Intent:** Encapsulate layer instantiation in the LayerType.

`LayerType.createLayer(parameters, data)` extracts data arrays, resolves all axis quantity kinds, and returns a ready-to-render layer. `Plot` calls this without knowing type-specific details.

**Benefits:** Data extraction co-located with layer type; validation at the type level.

---

### 6. Registry Pattern — AxisRegistry

**Intent:** Central scale registry with lazy initialisation and quantity kind validation.

`AxisRegistry.ensureAxis(name, quantityKind)` creates a D3 scale on first use. Subsequent calls with a different quantity kind throw, preventing incompatible data from sharing an axis.

**Benefits:** Single source of truth for scales; prevents quantity kind mismatch bugs at runtime.

---

### 7. Separation of Concerns — Canvas + SVG

**Intent:** Leverage each technology for what it does best.

- **WebGL canvas** renders data points (GPU-parallel, handles millions of points)
- **SVG overlay** renders axes, ticks, and labels (crisp text; pointer events for zoom)

The SVG sits on top with `pointer-events: none` on most elements so zoom/pan reach the canvas.

---

## Key Architectural Decisions

### Declarative API with Registry

A layer type registry and declarative config are more concise than an imperative builder API, easier to serialise, and enable schema introspection. Trade-off: one registration step per type, but that happens once at startup.

### Auto Range Calculation

Ranges are computed from data by default, eliminating boilerplate. Explicit overrides via `config.axes` remain available. Trade-off: negligible O(n) scan on each `update()`.

### Typed Arrays for GPU Efficiency

`Float32Array` maps directly to GPU memory with no conversion, matches GLSL `float` precision, and uses 4 bytes per value. Trade-off: slightly less convenient than regular arrays.

### Embedded Shaders

GLSL shaders are stored as strings inside `LayerType` instances, keeping all layer logic in one place and simplifying distribution. Trade-off: no editor syntax highlighting for the shader strings.

### Domain-Based Normalisation in the GPU

Coordinate normalisation happens in the vertex shader using `xDomain`/`yDomain` uniforms rather than on the CPU. The same data buffers are valid at any zoom level — zoom just changes the uniforms and triggers a re-render. Trade-off: slightly more complex shaders; benefit is smooth 60 fps zoom with no data copying.

### Multi-Axis Support

Four independent axes (top/bottom × left/right) with independent D3 scales support dual-y-axis plots and complex scientific visualisations. Each layer picks which axes to use.

### JSON Schema Support

Each `LayerType` provides a JSON Schema for its parameters. `Plot.schema()` aggregates all registered types. Enables validation, documentation generation, and IDE autocomplete without extra tooling.

---

## Performance Considerations

| Area | Complexity | Notes |
|------|-----------|-------|
| GPU rendering | O(n) GPU-parallel | Fragment fill rate is the typical bottleneck |
| Range calculation  | O(n) CPU, one pass per axis | Negligible for < 1 M points |
| Zoom handling | O(4) scale updates | One `render()` call per event |
| Memory | 4 bytes/value (Float32Array) | No data duplication; regl manages GPU buffers |

Datasets larger than GPU memory (~1 M+ points) may need chunking. No virtual scrolling is implemented.

---

## Future Considerations

Potential enhancements that maintain the current architecture:

1. **WebGL2** — upgrade regl context for instancing and compute
2. **Layer Groups** — batch show/hide
3. **Animation** — time-based attribute updates
4. **Point Picking** — GPU-based selection
5. **Texture Colormaps** — richer gradient support
6. **Runtime Validation** — enforce JSON Schema at `update()` time
7. **Serialisation** — save/restore plot configurations as JSON

All can be added without breaking the current API or architecture.
