# Gladly API Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library that uses WebGL (via [regl](https://github.com/regl-project/regl)) for high-performance data rendering and [D3.js](https://d3js.org/) for interactive axes and zoom controls.

The library features a **declarative API** where you register layer types once and then create plots by specifying data and layer configurations.

---

## Data Model

Understanding the core data model makes all other concepts fall into place.

### Axes

A plot has up to four **spatial axes**: `xaxis_bottom`, `xaxis_top`, `yaxis_left`, `yaxis_right`. Each axis has a **domain** [min, max] and a **quantity unit** (e.g. `"meters"`, `"volts"`) that enforces compatibility between layers sharing that axis.

In addition to spatial axes, each layer can declare:

- **Color axes** — map a numeric data dimension to a color via a colorscale. Each color axis is identified by a **quantity kind** string (e.g. `"temperature"`). Multiple layers sharing the same quantity kind automatically share a common range.
- **Filter axes** — map a numeric data dimension to a discard range. Same quantity kind = shared filter. Bounds are optional (open interval).

All axes (spatial, color, filter) can have their domains/ranges overridden in `config.axes`.

### LayerType

A **LayerType** defines a visualization strategy. It specifies:

- Spatial axis **quantity units** (`x`, `y`) — for unit compatibility checking
- Color axis **quantity kinds** — named slots (e.g. slot `"v"`) mapping to a shared color axis
- Filter axis **quantity kinds** — named slots (e.g. slot `"z"`) mapping to a shared filter axis
- **GLSL vertex and fragment shaders**
- A **JSON Schema** describing its configuration parameters
- A **`createLayer` factory** that extracts data arrays and returns a layer config object

### Layer

A **Layer** is a LayerType bound to specific data arrays. Layers are created automatically by `plot.update()` from the declarative layer specifications in `config.layers`.

Each layer holds:
- GPU **attributes** (`Float32Array` per GLSL attribute)
- GPU **uniforms** (scalars / typed arrays)
- Which **spatial axes** to use (`xAxis`, `yAxis`)
- Resolved **color axes** map (slot → `{ quantityKind, data, colorscale }`)
- Resolved **filter axes** map (slot → `{ quantityKind, data }`)

### Data Format

All data values must be `Float32Array` for direct GPU memory mapping:

```javascript
// Correct
const data = {
  x: new Float32Array([1, 2, 3]),
  y: new Float32Array([4, 5, 6]),
  v: new Float32Array([0.1, 0.5, 0.9])
}

// Incorrect — will throw
const bad = { x: [1, 2, 3], y: [4, 5, 6] }
```

### Config Structure

```javascript
plot.update({
  data: { /* named Float32Arrays */ },
  config: {
    layers: [
      // Each entry: { layerTypeName: { ...parameters } }
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ],
    axes: {
      // Spatial axes — omit for auto-domain
      xaxis_bottom: { min: 0, max: 100 },
      yaxis_left:   { min: 0, max: 50 },
      // Color axes — key is the quantity kind
      temperature: { min: 20, max: 80, colorscale: "plasma" },
      // Filter axes — both bounds optional (open interval)
      depth: { min: 10, max: 500 }
    }
  }
})
```

---

## Sub-topics

- **[Configuring Plots](api/PlotConfiguration.md)** — `plot.update()`, axes config, auto-domain, multi-layer, interaction, examples
- **[Writing Layer Types](api/LayerTypes.md)** — `LayerType` constructor, shaders, color axes, filter axes, GLSL helpers, constants, API reference

---

## Installation

```bash
npm install regl d3
```

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'
```

---

## Quick Start

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'

// 1. Register layer types once at startup
registerLayerType("scatter", scatterLayerType)

// 2. Prepare data as Float32Arrays
const x = new Float32Array([10, 20, 30, 40, 50])
const y = new Float32Array([15, 25, 35, 25, 45])
const v = new Float32Array([0.2, 0.4, 0.6, 0.8, 1.0])

// 3. Create plot
const plot = new Plot(document.getElementById("plot-container"))

// 4. Apply configuration and data
plot.update({
  data: { x, y, v },
  config: {
    layers: [
      { scatter: { xData: "x", yData: "y", vData: "v" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },
      yaxis_left:   { min: 0, max: 50 }
    }
  }
})
```

**HTML container:**
```html
<div id="plot-container" style="position: relative; width: 800px; height: 600px;"></div>
```

Width and height are auto-detected from `clientWidth`/`clientHeight` and update automatically via `ResizeObserver`.

---

## API Reference

### `Plot`

The main plotting container that manages WebGL rendering and SVG axes.

**Constructor:**
```javascript
new Plot(container)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Parent `<div>`. Must have explicit CSS dimensions. Canvas and SVG are created inside it automatically. |

**Instance methods:**

#### `update({ config, data })`

Updates the plot with new configuration and/or data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | `{ layers, axes }` — see [Configuring Plots](api/PlotConfiguration.md) |
| `config.layers` | array | Layer specifications: `[{ typeName: params }, ...]` |
| `config.axes` | object | Domain overrides for spatial, color, and filter axes |
| `data` | object | Named `Float32Array` values |

**Behaviour:**
- Config-only: stores config, waits for data before rendering
- Data-only: updates data, re-renders with existing config
- Both: updates and renders
- Neither: re-renders (equivalent to `forceUpdate()`)

#### `forceUpdate()`

Re-renders with existing config and data.

#### `destroy()`

Removes event listeners and destroys the WebGL context.

**Static methods:**

#### `Plot.schema()`

Returns JSON Schema (Draft 2020-12) for the plot configuration object, aggregated from all registered layer types.

---

### `registerLayerType(name, layerType)`

Registers a LayerType under a name for use in `config.layers`.

```javascript
registerLayerType("scatter", scatterLayerType)
```

Throws if `name` is already registered.

---

### `getLayerType(name)`

Returns the registered `LayerType` for `name`. Throws with a helpful message if not found.

---

### `getRegisteredLayerTypes()`

Returns an array of all registered layer type name strings.

---

### `scatterLayerType`

A built-in `LayerType` for scatter plots. See [Writing Layer Types — scatterLayerType](api/LayerTypes.md#scatterlayertype) for full details.

**Parameters:** `xData`, `yData`, `vData` (required), `xAxis`, `yAxis` (optional).
