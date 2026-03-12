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
- 🌎 Basemap layer with XYZ,WMS and WMTS support and CRS reprojection

## Documentation

- **[Quick Start](docs/Quickstart.md)** - Installation and minimal working example
- **[Configuration](docs/configuration/index.md)** - Plot configuration, layers, axes, colorscales, built-in computations
- **[User API](docs/user-api/index.md)** - Programmatic APIs for plots, axes, data, and computations
- **[Extension API](docs/extension-api/index.md)** - Writing custom layer types and computations
- **[Architecture](docs/architecture/index.md)** - Design patterns and module responsibilities

## Technology Stack

- **WebGL Rendering**: regl v2.1.0
- **Axes & Interaction**: D3.js v7.8.5
- **Module Format**: ES6 modules
- **Build Tool**: Parcel v2.9.0

## License

MIT
