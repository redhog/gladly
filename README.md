# Gladly

A lightweight, GPU-accelerated plotting library with a declarative API.

## Overview

Gladly combines WebGL rendering (via regl) with D3.js for interactive axes and zoom controls. It features a **declarative API** that lets you create high-performance plots with minimal boilerplate.

**Key Features:**
- 🚀 GPU-accelerated rendering using WebGL
- 💨 Zero JavaScript loops over data - all processing in GPU shaders
- 📊 Declarative plot configuration
- 🎯 Interactive multi-axis support (up to 4 axes)
- 🔍 Zoom and pan interactions
- 🧩 Extensible layer type registry
- 📏 Quantity and unit-aware axis management
- 🎨 Supports all standard colorscales
- 🔗 Subplot axis linking
- 🌈 Axis to coloring or filtering linking
- 🌎 GIS layers:
  - 🗺️ Tile sources: XYZ, WMS, WMTS, COG
  - 🌍 Basemap layer
  - 🏔️ 3D terrain layer: satellite imagery draped over DTM elevation meshes
  - 🌐 CRS reprojection

## Extensions

- **[gladly-jupyter](https://redhog.github.io/gladly-jupyter/)** - Jupyter notebook widget extension for Gladly

## Documentation

- **[Quick Start](docs/Quickstart.md)** - Installation and minimal working example
- **[Concepts](docs/concepts/Overview.md)** - Data model overview: axes, quantity kinds, colorscales, layer types, data format
- **[Configuration](docs/configuration/overview.md)** - Plot configuration, layers, axes, colorscales, built-in computations
- **[User API](docs/user-api/overview.md)** - Programmatic APIs for plots, axes, data, and computations
- **[Extension API](docs/extension-api/overview.md)** - Writing custom layer types and computations
- **[Architecture](docs/architecture/overview.md)** - Design patterns and module responsibilities

## Technology Stack

- **WebGL Rendering**: regl v2.1.0
- **Axes & Interaction**: D3.js v7.8.5
- **Module Format**: ES6 modules
- **Build Tool**: Parcel v2.9.0

## Development

Install dependencies:

```bash
npm install
```

Run the test suite (launches a real Chromium browser via Playwright):

```bash
npm test
```

Tests live in `test/`. The `pretest` script pre-bundles CJS dependencies (regl, proj4) to ESM before the runner starts. On first run, Playwright downloads its Chromium binary automatically.

To run a subset of tests by name:

```bash
npm test -- --grep "uploadToTexture"
```

## License

MIT
