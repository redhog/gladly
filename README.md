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
- 📏 Unit-aware axis management
- ⚡ ~250 lines of focused source code

## Quick Start

```bash
# Install dependencies
npm install

# Run the example
npm start
```

Open your browser to `http://localhost:1234` to see the demo.

## Basic Usage

```javascript
import { Plot, registerLayerType, ScatterLayer } from './src/index.js';

// Register layer types
registerLayerType('scatter', ScatterLayer);

// Prepare data (all arrays must be Float32Array)
const data = {
  x: new Float32Array([1, 2, 3, 4, 5]),
  y: new Float32Array([2, 4, 3, 5, 4])
};

// Create plot (just the container)
const plot = new Plot(document.getElementById('plot'));

// Apply configuration and data
plot.update({
  config: {
    layers: [
      {
        scatter: {
          xDataKey: 'x',
          yDataKey: 'y',
          xAxis: 'xaxis_bottom',
          yAxis: 'yaxis_left'
        }
      }
    ]
  },
  data
});
```

## Documentation

- **[API Documentation](docs/API.md)** - Complete API reference and usage guide
- **[Architecture Documentation](docs/ARCHITECTURE.md)** - Developer guide and design patterns

## Technology Stack

- **WebGL Rendering**: regl v2.1.0
- **Axes & Interaction**: D3.js v7.8.5
- **Module Format**: ES6 modules
- **Build Tool**: Parcel v2.9.0

## License

MIT
