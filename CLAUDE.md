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

- **[API Documentation](docs/API.md)**: User-facing API reference for using the library
  - Installation and quick start
  - Declarative plot creation
  - Layer type registration
  - Core classes (Plot, LayerType, Layer)
  - Data format requirements
  - Interaction features
  - Complete examples

- **[Architecture Documentation](docs/ARCHITECTURE.md)**: Developer-facing architecture guide
  - Declarative API design
  - Layer type registry pattern
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
  - index.js              # Public API exports
  - Plot.js               # Main rendering orchestrator
  - Layer.js              # Data container (internal)
  - LayerType.js          # Shader definition + schema + factory
  - ScatterLayer.js       # Scatter plot implementation
  - AxisRegistry.js       # Scale management (internal)
  - LayerTypeRegistry.js  # Layer type registration
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
- All data must be Float32Array for GPU efficiency
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

This ensures all changes are deliberate and aligned with project goals.
