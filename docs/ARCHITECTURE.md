# Gladly Architecture Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library built on WebGL (via regl) and D3.js. The architecture is designed around a clean separation between GPU-based data rendering and DOM-based axis/interaction management. With only ~214 lines of source code across 6 modules, it provides high-performance visualization through efficient use of WebGL shaders and typed arrays.

**Key Architectural Principles:**
- GPU rendering for data points using WebGL
- SVG overlay for axes and labels
- Lazy initialization of scales
- Unit-aware multi-axis system
- Strategy pattern for extensible layer types

---

## Project Structure

```
gladly/
├── src/
│   ├── index.js              # 5 LOC  - Public API exports
│   ├── Plot.js               # 92 LOC - Main rendering orchestrator
│   ├── Layer.js              # 12 LOC - Data container
│   ├── LayerType.js          # 24 LOC - Shader + metadata
│   ├── ScatterLayer.js       # 42 LOC - Scatter plot implementation
│   └── AxisRegistry.js       # 39 LOC - Scale management
├── example/
│   ├── main.js               # Example usage
│   └── index.html            # Demo page
├── package.json
└── docs/
    ├── API.md                # User-facing documentation
    └── ARCHITECTURE.md       # This file
```

**Total Source:** ~214 lines (excluding examples and build config)

---

## Core Components

### Component Dependency Graph

```
Plot (main orchestrator)
  ├── regl (WebGL context)
  ├── D3 (selection, scales, axes, zoom)
  ├── Layer[] (data layers)
  │   └── LayerType (rendering strategy)
  │       └── ScatterLayer (concrete implementation)
  └── AxisRegistry (scale manager)
      └── D3 scales (linear/log)
```

### Module Responsibilities

#### **1. index.js** (5 LOC)
**Purpose:** Public API surface

**Exports:**
- `LayerType` - Class for defining custom layer types
- `Layer` - Class for data layers
- `AxisRegistry` - Class for axis/scale management
- `Plot` - Main plotting class
- `scatterLayerType` - Pre-built scatter LayerType
- `AXES` - Array of available axis names
- `AXIS_UNITS` - Object of unit definitions

**Role:** Single entry point for external users

---

#### **2. AxisRegistry.js** (39 LOC)
**Purpose:** Centralized scale management with unit validation

**Pattern:** Registry pattern with lazy initialization

**Responsibilities:**
- Create and store D3 scales for up to 4 axes
- Enforce unit consistency (prevent mixing incompatible units)
- Map axis names to pixel ranges based on position

**Key Data Structures:**
```javascript
this.scales = {}  // { axisName: D3Scale }
this.units = {}   // { axisName: unitString }
```

**Supported Axes:**
- `xaxis_bottom` → range: [0, width]
- `xaxis_top` → range: [0, width]
- `yaxis_left` → range: [height, 0] (inverted for canvas coords)
- `yaxis_right` → range: [height, 0]

**Supported Units:**
- `meters` - Linear scale, label: "Meters"
- `volts` - Linear scale, label: "Volts"
- `log10` - Logarithmic scale, label: "Log10"

**Validation:** Throws error if attempting to use an axis with different unit than previously registered

---

#### **3. LayerType.js** (24 LOC)
**Purpose:** Encapsulate rendering strategy (shaders + metadata)

**Pattern:** Strategy pattern

**Responsibilities:**
- Store shader code (GLSL vertex and fragment)
- Define attribute mappings (data → GPU)
- Specify axis units for type checking
- Generate regl draw commands

**Key Properties:**
```javascript
{
  name: string,           // Type identifier
  xUnit: string,          // Required x-axis unit
  yUnit: string,          // Required y-axis unit
  vert: string,           // GLSL vertex shader
  frag: string,           // GLSL fragment shader
  attributes: object      // Attribute accessors
}
```

**Method: createDrawCommand(regl)**
- Compiles shaders into regl draw command
- Adds uniforms: `xDomain`, `yDomain`, `count`
- Returns function that can be called to render

---

#### **4. ScatterLayer.js** (42 LOC)
**Purpose:** Concrete LayerType implementation for scatter plots

**Extends:** LayerType

**Configuration:**
- **Name:** "scatter"
- **Units:** "meters" (both x and y)
- **Attributes:** x, y, v

**Vertex Shader:**
```glsl
// Normalizes data coordinates to GPU clip space [-1, 1]
xNorm = (x - xDomain[0]) / (xDomain[1] - xDomain[0]) * 2.0 - 1.0
yNorm = (y - yDomain[0]) / (yDomain[1] - yDomain[0]) * 2.0 - 1.0
gl_PointSize = 4.0
```

**Fragment Shader:**
```glsl
// Maps value (0-1) to color gradient: red → white → blue
gl_FragColor = vec4(v, 0.0, 1.0 - v, 1.0)
```

**Helper Function: prop()**
- Extracts nested properties from regl context
- Usage: `prop('data.x')` returns `(context, props) => props.data.x`

---

#### **5. Layer.js** (12 LOC)
**Purpose:** Lightweight data container

**Pattern:** Data Transfer Object (DTO)

**Responsibilities:**
- Validate data types (must be Float32Array)
- Associate data with LayerType
- Specify which axes to use

**Validation Rules:**
- `data.x` must be Float32Array
- `data.y` must be Float32Array
- `data.v` must be Float32Array (if provided)
- Throws TypeError on validation failure

**Why Float32Array?**
- Direct GPU memory mapping (no conversion overhead)
- 32-bit precision matches GPU shader precision
- Compact binary format

---

#### **6. Plot.js** (92 LOC)
**Purpose:** Main rendering orchestrator

**Responsibilities:**
- Initialize WebGL context (via regl)
- Manage D3 SVG selections
- Store and execute layer draw commands
- Handle zoom interactions
- Coordinate rendering pipeline

**Key Properties:**
```javascript
this.regl          // WebGL context
this.svg           // D3 selection of SVG overlay
this.layers = []   // Array of Layer instances
this.draws = []    // Array of regl draw commands
this.axisRegistry  // Reference to AxisRegistry
```

**Key Methods:**

**addLayer(layer):**
1. Ensure axes exist with correct units
2. Create draw command from LayerType
3. Store layer and draw command
4. Set initial domains based on data ranges

**render():**
1. Clear canvas to white
2. Execute all draw commands (GPU rendering)
3. Call renderAxes()

**renderAxes():**
1. For each axis in registry:
2. Create D3 axis generator (axisBottom/axisTop/axisLeft/axisRight)
3. Render to SVG `<g>` element

**initZoom():**
1. Create D3 zoom behavior
2. Attach to canvas
3. On zoom: rescale all axis domains proportionally
4. Call render() each frame

**setupAxisZoom(axisName):**
1. Create D3 zoom behavior for single axis
2. Attach to axis SVG group
3. On zoom: rescale only that axis domain
4. Call render() each frame

---

## Data Flow

### Setup Phase (Initialization)

```
1. User creates Layer with data
   └─> Layer validates Float32Array types

2. User creates Plot(canvas, svg)
   └─> Plot initializes regl context
   └─> Plot creates D3 SVG selection

3. User creates AxisRegistry(width, height)
   └─> Registry initialized with empty scales

4. User calls plot.setAxisRegistry(registry)
   └─> Plot stores registry reference

5. User calls plot.addLayer(layer)
   ├─> AxisRegistry.ensureAxis(xAxis, layer.type.xUnit)
   │   └─> Creates D3 scale if doesn't exist
   ├─> AxisRegistry.ensureAxis(yAxis, layer.type.yUnit)
   ├─> LayerType.createDrawCommand(regl)
   │   └─> Compiles shaders, creates GPU draw function
   ├─> Calculate initial domain from data min/max
   │   └─> scale.domain([min, max])
   └─> Store layer and draw command

6. User calls plot.render()
   └─> (See Render Cycle below)
```

---

## Rendering Pipeline

### Render Cycle (per frame)

```
plot.render()
  │
  ├─> regl.clear({ color: [1, 1, 1, 1] })
  │   └─> Fill canvas with white
  │
  ├─> For each draw command:
  │   ├─> Get current xDomain from scale
  │   ├─> Get current yDomain from scale
  │   ├─> Call drawCommand({
  │   │     data: layer.data,
  │   │     xDomain: [min, max],
  │   │     yDomain: [min, max],
  │   │     count: data.x.length
  │   │   })
  │   │   │
  │   │   └─> GPU Execution:
  │   │       ├─> For each vertex (point):
  │   │       │   ├─> Vertex shader: normalize coords to [-1, 1]
  │   │       │   └─> Output: gl_Position, varying values
  │   │       │
  │   │       └─> For each fragment (pixel):
  │   │           └─> Fragment shader: compute color
  │   │               └─> Output: gl_FragColor
  │
  └─> plot.renderAxes()
      └─> For each axis in registry:
          ├─> Create D3 axis generator
          ├─> Select or create SVG <g> element
          └─> Call axis generator (draws ticks, labels)
```

---

## Interaction Cycle (Zoom)

### Canvas Zoom (All Axes)

```
User scrolls on canvas
  │
  ├─> D3 zoom event triggered
  │
  ├─> For each axis in registry:
  │   ├─> Get current scale
  │   ├─> Apply zoom transform
  │   └─> Update scale domain
  │
  └─> plot.render()
      └─> (See Render Cycle)
```

### Axis-Specific Zoom

```
User scrolls over axis SVG element
  │
  ├─> D3 zoom event on axis group
  │
  ├─> Get axis scale
  ├─> Apply zoom transform to that scale only
  │
  └─> plot.render()
      └─> (See Render Cycle)
```

---

## Dependencies

### External Libraries

#### **regl v2.1.0**
**Purpose:** WebGL abstraction layer

**Usage:**
- Create WebGL context from canvas
- Compile shaders
- Manage GPU state and buffers
- Execute draw commands

**Why regl?**
- Functional API (no global state)
- Automatic resource management
- Handles shader compilation errors
- Simplifies attribute/uniform binding

#### **d3 v7.8.5**
**Purpose:** Scales, axes, and interaction

**Modules Used:**
- `d3-selection`: DOM querying and manipulation
- `d3-scale`: Domain/range mapping (linear, log scales)
- `d3-axis`: Axis rendering (ticks, labels)
- `d3-zoom`: Mouse/touch zoom behavior

**Why D3?**
- Industry-standard for data visualization
- Robust scale transformations
- Built-in axis formatters
- Smooth zoom transitions

---

## Design Patterns

### 1. Strategy Pattern (LayerType)

**Intent:** Define a family of rendering algorithms, encapsulate each one, and make them interchangeable.

**Implementation:**
- `LayerType` is the strategy interface
- `scatterLayerType` is a concrete strategy
- Additional types (line, heatmap, etc.) can be added without modifying Plot

**Benefits:**
- Easy to add new visualization types
- Shader code isolated in LayerType instances
- Each type can specify different units

---

### 2. Registry Pattern (AxisRegistry)

**Intent:** Maintain a central registry of scales, prevent duplicates, enforce constraints.

**Implementation:**
- `AxisRegistry` stores all scales by name
- `ensureAxis()` creates or retrieves scales
- Unit validation prevents incompatible layers on same axis

**Benefits:**
- Single source of truth for scales
- Prevents unit mismatch bugs
- Lazy initialization (scales created on demand)

---

### 3. Separation of Concerns

**GPU Rendering (WebGL/regl):**
- Handles data visualization
- Executes shaders for each point
- Renders to canvas

**DOM Interaction (D3/SVG):**
- Handles axes, labels, ticks
- Manages zoom interactions
- Overlays on canvas

**Benefits:**
- GPU optimized for large datasets
- SVG provides crisp text rendering
- Independent update cycles

---

## Key Architectural Decisions

### 1. Typed Arrays for GPU Efficiency

**Decision:** Require Float32Array for all data

**Rationale:**
- Direct GPU memory mapping (no CPU-side conversion)
- Matches GLSL float precision
- Memory efficient (4 bytes per value)

**Trade-off:** Slightly less convenient than regular arrays, but massive performance gain

---

### 2. Embedded Shaders

**Decision:** Store GLSL shaders as strings in LayerType classes

**Rationale:**
- Self-contained layer definitions
- No separate shader files to manage
- Easy to see vertex/fragment relationship

**Trade-off:** No syntax highlighting, but simplifies distribution

---

### 3. Canvas + SVG Overlay

**Decision:** Render data to canvas, axes to SVG

**Rationale:**
- WebGL excels at rendering large point clouds
- SVG provides crisp text and perfect lines
- SVG has `pointer-events: none` to allow canvas zoom

**Trade-off:** Two rendering contexts, but leverages strengths of each

---

### 4. Domain-Based Rendering

**Decision:** Normalize in GPU using domain uniforms, not CPU pre-processing

**Rationale:**
- Same data buffers valid at any zoom level
- No CPU-side coordinate transformation on zoom
- Smooth 60fps zoom without data copying

**Trade-off:** Slightly more complex shaders, but dramatically better performance

---

### 5. Multi-Axis Support

**Decision:** Support 4 axes (top/bottom x, left/right y) with independent scales

**Rationale:**
- Enables dual y-axis plots (different units/scales)
- Supports complex scientific visualizations
- Each layer can choose which axes to use

**Trade-off:** More complex axis management, but essential for scientific plotting

---

### 6. Lazy Scale Creation

**Decision:** Create scales only when layers added, not at initialization

**Rationale:**
- Minimal startup overhead
- Only create what's needed
- Unit enforcement at creation time

**Trade-off:** Can't set domains before adding layers, but cleaner API

---

## Performance Considerations

### GPU Rendering
- **Complexity:** O(n) for n points, GPU-accelerated
- **Bottleneck:** Fragment shader fill rate for overlapping points
- **Optimization:** Point size kept small (4.0 pixels)

### Zoom Handling
- **Complexity:** O(4) - updates up to 4 axis scales
- **Optimization:** Render called once per zoom event, not per axis
- **Smoothness:** Relies on requestAnimationFrame for 60fps

### Memory Usage
- **Data Storage:** Float32Array uses 4 bytes per value
- **GPU Buffers:** regl creates GPU buffers from typed arrays
- **No Copying:** Data stays in typed arrays, no duplication

### No Virtual Scrolling
- **Assumption:** Dataset fits in GPU memory
- **Limitation:** Very large datasets (>1M points) may need chunking
- **Current:** Example uses 5000 points, renders smoothly

---

## Extensibility Points

### Adding New LayerTypes

Create a new LayerType instance with custom shaders:

```javascript
export const lineLayerType = new LayerType({
  name: "line",
  xUnit: "meters",
  yUnit: "volts",
  vert: `/* custom vertex shader */`,
  frag: `/* custom fragment shader */`,
  attributes: { x: prop("data.x"), y: prop("data.y") }
})
```

### Adding New Units

Modify `AXIS_UNITS` in AxisRegistry.js:

```javascript
export const AXIS_UNITS = {
  meters: { label: "Meters", scale: "linear" },
  volts: { label: "Volts", scale: "linear" },
  log10: { label: "Log10", scale: "log" },
  // Add new unit:
  temperature: { label: "°C", scale: "linear" }
}
```

### Adding New Axes

Modify `AXES` array in AxisRegistry.js and add mapping in `ensureAxis()`:

```javascript
export const AXES = [
  "xaxis_bottom", "xaxis_top",
  "yaxis_left", "yaxis_right",
  "xaxis_center"  // New axis
]
```

---

## Future Considerations

Potential enhancements that maintain the current architecture:

1. **WebGL2:** Upgrade to regl with WebGL2 context for instancing
2. **Layer Groups:** Add layer grouping for batch show/hide
3. **Animation:** Add time-based attribute updates
4. **Selection:** Add GPU-based point picking
5. **Textures:** Add texture-based colormaps for more complex gradients

All can be added without breaking current API or architecture.
