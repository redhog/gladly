# Gladly - GPU-Accelerated Plotting Library

## Project Overview

Gladly is a lightweight, high-performance plotting library that combines WebGL (via regl) for GPU-accelerated data rendering with D3.js for interactive axes and zoom controls. It's designed for visualizing large datasets with multi-axis support and extensible shader-based rendering.

**Key Features:**
- GPU-accelerated rendering using WebGL
- Interactive multi-axis support (up to 4 axes)
- Zoom and pan interactions
- Extensible layer system with custom shaders
- Unit-aware axis management
- ~214 lines of focused source code

## Documentation

For detailed information about using and understanding Gladly:

- **[API Documentation](docs/API.md)**: User-facing API reference for using the library
  - Installation and quick start
  - Core classes (Plot, Layer, LayerType, AxisRegistry)
  - Data format requirements
  - Interaction features
  - Complete examples

- **[Architecture Documentation](docs/ARCHITECTURE.md)**: Developer-facing architecture guide
  - Project structure and module organization
  - Component responsibilities and dependencies
  - Data flow and rendering pipeline
  - Design patterns and architectural decisions
  - Performance considerations
  - Extensibility points

## Technology Stack

- **WebGL Rendering**: regl v2.1.0
- **Axes & Interaction**: D3.js v7.8.5 (d3-selection, d3-scale, d3-axis, d3-zoom)
- **Module Format**: ES6 modules
- **Build Tool**: Parcel v2.9.0 (for examples)

## Quick Reference

### Project Structure
```
src/
  - index.js          # Public API exports
  - Plot.js           # Main rendering orchestrator
  - Layer.js          # Data container
  - LayerType.js      # Shader definition
  - ScatterLayer.js   # Scatter plot implementation
  - AxisRegistry.js   # Scale management
example/
  - main.js           # Usage example
  - index.html        # Demo page
```

### Core Concepts

1. **Plot**: Main container managing WebGL canvas and SVG axes
2. **Layer**: Data wrapper requiring Float32Array format
3. **LayerType**: Rendering strategy with custom GLSL shaders
4. **AxisRegistry**: Scale manager enforcing unit consistency

### Development

Run the example:
```bash
npm install
npm start
```

## Working with This Codebase

- All data must be Float32Array for GPU efficiency
- Shaders are embedded as strings in LayerType instances
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

This ensures all changes are deliberate and aligned with project goals.
