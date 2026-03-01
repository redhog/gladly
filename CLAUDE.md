# Gladly - GPU-Accelerated Plotting Library

## Project Overview

Gladly is a lightweight, high-performance plotting library that combines WebGL (via regl) for GPU-accelerated data rendering with D3.js for interactive axes and zoom controls. It features a **declarative API** for creating plots with minimal boilerplate.

**Key Features:**
- Declarative plot configuration with data and layer specifications
- GPU-accelerated rendering using WebGL
- Interactive multi-axis support (up to 4 axes)
- Auto-domain calculation from data
- Zoom and pan interactions
- Extensible layer type registry system
- JSON Schema introspection
- Unit-aware axis management
- ~250 lines of focused source code

## Documentation

For detailed information about using and understanding Gladly:

- **[Quick Start](docs/Quickstart.md)**: Installation and minimal working example
- **[API Documentation](docs/API.md)**: User-facing API reference overview and data model
  - **[Configuring Plots](docs/api/PlotConfiguration.md)**: `plot.update()`, axes config, auto-range, multi-layer, interaction, examples
  - **[Writing Layer Types](docs/api/LayerTypes.md)**: `LayerType` constructor, shaders, color/filter axes, GLSL helpers, constants
  - **[Computed Attributes](docs/api/ComputedAttributes.md)**: GPU texture and GLSL computations in layer attributes; `TextureComputation` / `GlslComputation` base classes; `EXPRESSION_REF`; `computationSchema`; built-in computations
  - **[API Reference](docs/api/Reference.md)**: `Plot`, `registerLayerType`, `getLayerType` and other public API entries

- **[Architecture Documentation](docs/ARCHITECTURE.md)**: Developer-facing architecture overview
  - **[Module Responsibilities](docs/architecture/Modules.md)**: Per-module purpose, patterns, key properties and methods
  - **[Data Flow & Rendering](docs/architecture/DataFlow.md)**: Setup phase, render cycle, zoom/pan interaction

## Technology Stack

- **WebGL Rendering**: regl v2.1.0
- **Axes & Interaction**: D3.js v7.8.5 (d3-selection, d3-scale, d3-axis, d3-zoom)
- **Module Format**: ES6 modules
- **Build Tool**: Parcel v2.9.0 (for examples)

## Quick Reference

### Project Structure
```
src/
  - index.js                        # Public API exports
  core/
    - Plot.js                       # Main rendering orchestrator
    - Layer.js                      # Data container (internal)
    - LayerType.js                  # Shader definition + schema + factory
    - Data.js                       # Data normalisation wrapper
    - LayerTypeRegistry.js          # Layer type registration
  axes/
    - Axis.js                       # First-class axis object
    - AxisRegistry.js               # Spatial scale management (internal)
    - AxisLink.js                   # Cross-plot axis linking
    - AxisQuantityKindRegistry.js   # Global quantity kind definitions
    - ColorAxisRegistry.js          # Color axis range + colorscale management
    - FilterAxisRegistry.js         # Filter axis range management + GLSL helper
    - ZoomController.js             # Zoom and pan interaction
  colorscales/
    - ColorscaleRegistry.js         # GLSL colorscale registration + dispatch builder
    - MatplotlibColorscales.js      # All matplotlib 1D colorscales pre-registered
    - BivariateColorscales.js       # 2D colorscales pre-registered
  layers/
    - ScatterShared.js              # Shared base class for points/lines layer types
    - PointsLayer.js                # Points (scatter) layer type implementation
    - LinesLayer.js                 # Lines layer type implementation
    - ColorbarLayer.js              # 1D colorbar gradient LayerType
    - ColorbarLayer2d.js            # 2D colorbar LayerType
    - FilterbarLayer.js             # Filterbar axis LayerType
    - TileLayer.js                  # Map tile LayerType (XYZ/WMS/WMTS)
  floats/
    - Float.js                      # Draggable, resizable floating widget container
    - Colorbar.js                   # 1D colorbar plot (extends Plot)
    - Colorbar2d.js                 # 2D colorbar plot (extends Plot)
    - Filterbar.js                  # Filterbar plot (extends Plot)
  geo/
    - EpsgUtils.js                  # EPSG/CRS projection utilities
  compute/
    - ComputationRegistry.js          # Computation / TextureComputation / GlslComputation base classes;
                                      # registerTextureComputation / registerGlslComputation;
                                      # EXPRESSION_REF / computationSchema / resolveAttributeExpr / isTexture
    - hist.js                         # 'histogram' TextureComputation
    - axisFilter.js                   # 'filteredHistogram' TextureComputation (axis-reactive)
    - kde.js                          # 'kde' TextureComputation
    - filter.js                       # 'filter1D' / 'lowPass' / 'highPass' / 'bandPass' TextureComputations
    - fft.js                          # 'fft1d' / 'fftConvolution' TextureComputations
    - conv.js                         # 'convolution' TextureComputation (adaptive GPU)
example/
  - main.js               # Usage example (declarative API)
  - index.html            # Demo page
```

### Core Concepts

1. **Declarative Configuration**: Specify data and layer list to create plots
2. **Layer Type Registry**: Register layer types once, reference by name
3. **Plot**: Main container with automatic setup (AxisRegistry, layers, domains)
4. **LayerType**: Rendering strategy with GLSL shaders, schema, and factory
5. **Auto-Domain Calculation**: Domains computed from data, overridable

### Development

Run the example:
```bash
npm install
npm start
```

## Working with This Codebase

### API Pattern
- **Declarative**: Users pass data and layer configs to Plot constructor
- **Layer Types**: Registered globally, referenced by name in layer specs
- **Data Structure**: Arbitrary object structure, interpreted by layer types
- **Auto-Setup**: Plot creates AxisRegistry, processes layers, calculates domains

### Key Implementation Details
- Attribute values in `createLayer` are `Float32Array` or **computed attribute expressions** (`{ computationName: params }`); resolved by `ComputationRegistry.resolveAttributeExpr`
- Shaders are embedded as strings in LayerType instances
- Layer types provide JSON Schema (Draft 2020-12) for their parameters
- Layer types include factory methods to create Layer instances
- Plot auto-calculates domains from data, allows overrides via `axes` param
- Axes use D3 scales with lazy initialization
- Rendering uses dual surfaces: WebGL canvas + SVG overlay
- Unit validation prevents incompatible data on same axis

## Workflow Instructions for Claude Code

**CRITICAL REQUIREMENTS:**

1. **Never start or restart the dev server** - Do not run `npm start` or any commands that start/restart development servers
2. **Never make changes directly** - Do not edit, write, or modify any files without explicit approval
3. **Always present a plan first** - Before making any code changes:
   - Analyze the request and existing code
   - Present a clear plan of what changes are needed
   - Ask for clarification if requirements are unclear
   - Wait for explicit go-ahead before proceeding with modifications
4. **Documentation function signatures must be complete** - When writing or updating docs, always show the full function signature including all parameters, even if a specific example does not use all of them. Never abbreviate to `function(parameters)` when the actual signature is `function(parameters, data)`.
5. **No backwards compatibility** - This is an early-stage project. When making changes:
   - Do NOT add backwards compatibility shims, deprecated exports, or compatibility proxies
   - Make breaking changes cleanly without preserving old APIs
   - Update all code to use new patterns immediately
   - Backwards compatibility is irrelevant at this stage

This ensures all changes are deliberate and aligned with project goals.
