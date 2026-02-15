# Gladly Architecture Documentation

## Overview

Gladly is a GPU-accelerated multi-axis plotting library built on WebGL (via regl) and D3.js. The architecture is designed around a **declarative API** with clean separation between GPU-based data rendering and DOM-based axis/interaction management. With ~250 lines of source code across 7 modules, it provides high-performance visualization through efficient use of WebGL shaders and typed arrays.

**Key Architectural Principles:**
- Declarative plot configuration with data and layer specifications
- GPU rendering for data points using WebGL
- SVG overlay for axes and labels
- Layer type registry for extensibility
- Auto-domain calculation from data
- Unit-aware multi-axis system
- Strategy pattern for extensible layer types

---

## Project Structure

```
gladly/
├── src/
│   ├── index.js              # 6 LOC  - Public API exports
│   ├── Plot.js               # 150 LOC - Main rendering orchestrator
│   ├── Layer.js              # 12 LOC - Data container
│   ├── LayerType.js          # 38 LOC - Shader + metadata + schema
│   ├── ScatterLayer.js       # 60 LOC - Scatter plot implementation
│   ├── AxisRegistry.js       # 42 LOC - Scale management
│   └── LayerTypeRegistry.js  # 17 LOC - Layer type registration
├── example/
│   ├── main.js               # Example usage
│   └── index.html            # Demo page
├── package.json
└── docs/
    ├── API.md                # User-facing documentation
    └── ARCHITECTURE.md       # This file
```

**Total Source:** ~250 lines (excluding examples and build config)

---

## Core Components

### Component Dependency Graph

```
Plot (main orchestrator)
  ├── regl (WebGL context)
  ├── D3 (selection, scales, axes, zoom)
  ├── AxisRegistry (created internally)
  │   └── D3 scales (linear/log)
  ├── LayerTypeRegistry (global)
  │   └── LayerType instances (by name)
  └── Layer[] (data layers, created automatically)
      └── LayerType (rendering strategy)
          └── ScatterLayer (concrete implementation)
```

### Module Responsibilities

#### **1. index.js** (6 LOC)
**Purpose:** Public API surface

**Exports:**
- `LayerType` - Class for defining custom layer types
- `Layer` - Class for data layers (internal use)
- `AxisRegistry` - Class for axis/scale management (internal use)
- `Plot` - Main plotting class
- `scatterLayerType` - Pre-built scatter LayerType
- `registerLayerType` - Function to register layer types
- `getLayerType` - Function to retrieve layer types
- `getRegisteredLayerTypes` - Function to list registered types
- `AXES` - Array of available axis names
- `AXIS_UNITS` - Object of unit definitions

**Role:** Single entry point for external users

---

#### **2. LayerTypeRegistry.js** (17 LOC)
**Purpose:** Global registry for layer types

**Pattern:** Registry pattern

**Responsibilities:**
- Store LayerType instances by name
- Prevent duplicate registrations
- Provide retrieval and listing functions
- Enable declarative layer specification

**Key Data Structure:**
```javascript
const registry = new Map()  // name -> LayerType
```

**API:**
- `registerLayerType(name, layerType)` - Register a layer type
- `getLayerType(name)` - Retrieve a layer type by name
- `getRegisteredLayerTypes()` - List all registered names

**Error Handling:**
- Throws if attempting to register duplicate name
- Throws if retrieving unregistered name (with helpful message listing available types)

---

#### **3. AxisRegistry.js** (42 LOC)
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
- `m/s` - Linear scale, label: "m/s"
- `ampere` - Linear scale, label: "Ampere"
- `log10` - Logarithmic scale, label: "Log10"

**Validation:** Throws error if attempting to use an axis with different unit than previously registered

---

#### **4. LayerType.js** (38 LOC)
**Purpose:** Encapsulate rendering strategy with schema and factory

**Pattern:** Strategy pattern + Factory pattern

**Responsibilities:**
- Store shader code (GLSL vertex and fragment)
- Define attribute mappings (data → GPU)
- Specify axis units for type checking
- Provide JSON Schema for layer parameters
- Create Layer instances from parameters and data
- Generate regl draw commands

**Key Properties:**
```javascript
{
  name: string,           // Type identifier
  xUnit: string,          // Required x-axis unit
  yUnit: string,          // Required y-axis unit
  vert: string,           // GLSL vertex shader
  frag: string,           // GLSL fragment shader
  attributes: object,     // Attribute accessors
  schema: function,       // Returns JSON Schema
  createLayer: function   // Factory for Layer instances
}
```

**Methods:**

**createDrawCommand(regl):**
- Compiles shaders into regl draw command
- Adds uniforms: `xDomain`, `yDomain`, `count`
- Returns function that can be called to render

**schema():**
- Returns JSON Schema (Draft 2020-12) defining expected parameters
- Used by Plot.schema() to generate composite schema
- Documents required and optional parameters

**createLayer(parameters, data):**
- Extracts data from the data object using parameter keys
- Validates extracted data
- Creates and returns a Layer instance
- Called automatically by Plot constructor

---

#### **5. ScatterLayer.js** (60 LOC)
**Purpose:** Concrete LayerType implementation for scatter plots

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
// Maps value (0-1) to color gradient: blue → red
gl_FragColor = vec4(v, 0.0, 1.0 - v, 1.0)
```

**Schema:**
Defines parameters: `xData` (required), `yData` (required), `vData` (required), `xAxis` (optional), `yAxis` (optional)

**Factory Method:**
Extracts data properties from data object and creates Layer instance

**Helper Function: prop()**
- Extracts nested properties from regl context
- Usage: `prop('data.x')` returns `(context, props) => props.data.x`

---

#### **6. Layer.js** (12 LOC)
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

#### **7. Plot.js** (150 LOC)
**Purpose:** Main rendering orchestrator with declarative API

**Responsibilities:**
- Initialize WebGL context (via regl)
- Create AxisRegistry internally
- Process declarative layer specifications
- Auto-calculate domain bounds from data
- Manage D3 SVG selections
- Store and execute layer draw commands
- Handle zoom and pan interactions
- Coordinate rendering pipeline

**Key Properties:**
```javascript
this.regl          // WebGL context
this.svg           // D3 selection of SVG overlay
this.layers = []   // Array of Layer instances
this.axisRegistry  // AxisRegistry instance (created internally)
```

**Constructor Parameters:**
```javascript
{
  container,       // HTMLElement - parent container
  width,           // number
  height,          // number
  margin,          // { top, right, bottom, left } - optional
  data,            // object - arbitrary structure (Float32Arrays)
  plot: {          // plot configuration
    layers,        // array - layer specifications
    axes           // object - domain overrides (optional)
  }
}
```

**Key Methods:**

**_processLayers(layersConfig, data):** (internal)
1. For each layer spec `{ layerTypeName: parameters }`:
2. Lookup LayerType from registry
3. Call `layerType.createLayer(parameters, data)`
4. Register axes with AxisRegistry
5. Create draw command
6. Store layer

**_setDomains(axesOverrides):** (internal)
1. For each axis, collect data from all layers using that axis
2. Calculate min/max from Float32Array data
3. Apply calculated domain or use override from `axes` parameter

**render():**
1. Clear canvas to white
2. Execute all draw commands (GPU rendering)
3. Call renderAxes()

**renderAxes():**
1. For each axis in registry:
2. Create D3 axis generator (axisBottom/axisTop/axisLeft/axisRight)
3. Render to SVG `<g>` element with styling
4. Add unit labels

**initZoom():**
1. Create full-coverage SVG overlay rectangle
2. Create D3 zoom behavior with region detection
3. Support plot area zoom (all axes) and axis-specific zoom
4. Implement mouse-position-aware zoom (keep point under cursor fixed)
5. Call render() on each zoom event

**static schema():**
1. Get all registered layer types
2. For each type, get its schema via `layerType.schema()`
3. Combine into composite schema using `oneOf`
4. Return JSON Schema for plot configuration object (layers and axes)

---

## Data Flow

### Declarative Setup Phase

```
1. User registers layer types (once at startup)
   └─> registerLayerType("scatter", scatterLayerType)

2. User prepares data as Float32Arrays
   └─> const data = { x, y, v, ... }

3. User creates Plot with declarative config
   new Plot({ container, width, height, data, plot: { layers, axes } })
   │
   ├─> Plot creates canvas element and appends to container
   ├─> Plot creates SVG element and appends to container
   ├─> Plot initializes regl context
   ├─> Plot creates AxisRegistry internally
   │
   ├─> Plot._processLayers(plot.layers, data)
   │   │
   │   └─> For each { layerTypeName: parameters }:
   │       ├─> getLayerType(layerTypeName)
   │       ├─> layerType.createLayer(parameters, data)
   │       │   ├─> Extract data properties
   │       │   └─> Create Layer instance
   │       ├─> AxisRegistry.ensureAxis(layer.xAxis, layer.type.xUnit)
   │       │   └─> Create D3 scale if doesn't exist
   │       ├─> AxisRegistry.ensureAxis(layer.yAxis, layer.type.yUnit)
   │       ├─> LayerType.createDrawCommand(regl)
   │       │   └─> Compile shaders, create GPU draw function
   │       └─> Store layer and draw command
   │
   ├─> Plot._setDomains(plot.axes)
   │   ├─> For each axis, collect all data points
   │   ├─> Calculate min/max from data
   │   └─> Apply calculated domain or override from `plot.axes` param
   │
   ├─> Plot.initZoom()
   │   └─> Set up zoom/pan interactions
   │
   └─> Plot.render()
       └─> (See Render Cycle below)
```

**No Manual Steps Required:**
- No separate AxisRegistry creation
- No manual layer addition
- No manual domain setting (unless overriding)
- Plot is ready to use immediately after construction

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
  │   │     viewport: { x, y, width, height },
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
          ├─> Call axis generator (draws ticks, labels)
          └─> Add unit labels
```

---

## Interaction Cycle (Zoom/Pan)

### Plot Area Zoom/Pan (All Axes)

```
User scrolls/drags in plot area
  │
  ├─> D3 zoom event triggered
  │
  ├─> Detect region (plot_area)
  │
  ├─> For each axis (all 4):
  │   ├─> Get current scale
  │   ├─> Calculate zoom/pan transform
  │   │   └─> Keep point under cursor fixed
  │   └─> Update scale domain
  │
  └─> plot.render()
      └─> (See Render Cycle)
```

### Axis-Specific Zoom/Pan

```
User scrolls/drags over specific axis
  │
  ├─> D3 zoom event triggered
  │
  ├─> Detect region (e.g., xaxis_bottom)
  │
  ├─> Get axis scale
  ├─> Apply zoom/pan transform to that scale only
  │   └─> Keep point under cursor fixed
  │
  └─> plot.render()
      └─> (See Render Cycle)
```

**Advanced Zoom Behavior:**
- Tracks mouse position at gesture start
- Calculates data value at mouse position
- Applies zoom while keeping that data point fixed at mouse pixel
- Supports wheel (pure zoom) and drag (pan + zoom)
- Works independently for each axis

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

### 1. Declarative Configuration

**Intent:** Specify what to render, not how to render it.

**Implementation:**
- Users pass configuration objects to Plot constructor
- Layer specifications reference registered layer types by name
- Data object has arbitrary structure, interpreted by layer types
- Domains auto-calculated unless explicitly overridden

**Benefits:**
- Concise, readable plot creation
- No imperative setup steps
- Easy to serialize/deserialize plot configurations
- Self-documenting via JSON Schema

---

### 2. Registry Pattern (Layer Types)

**Intent:** Maintain a global registry of layer types for declarative lookup.

**Implementation:**
- `LayerTypeRegistry` stores LayerType instances by name
- Users register types once: `registerLayerType("scatter", scatterLayerType)`
- Plot looks up types by name from layer specifications
- Schema introspection via `Plot.schema()`

**Benefits:**
- Decouples layer type definition from plot creation
- Enables declarative layer specification
- Supports schema generation
- Easy to extend with new types

---

### 3. Strategy Pattern (LayerType)

**Intent:** Define a family of rendering algorithms, encapsulate each one, and make them interchangeable.

**Implementation:**
- `LayerType` is the strategy interface
- `scatterLayerType` is a concrete strategy
- Additional types (line, heatmap, etc.) can be added without modifying Plot
- Each type provides schema and factory method

**Benefits:**
- Easy to add new visualization types
- Shader code isolated in LayerType instances
- Each type can specify different units
- Type-specific parameter validation

---

### 4. Factory Pattern (Layer Creation)

**Intent:** Encapsulate layer creation logic in LayerType.

**Implementation:**
- Each LayerType provides `createLayer(parameters, data)` method
- Plot calls factory method during initialization
- Factory extracts relevant data from arbitrary data object
- Factory validates and creates Layer instance

**Benefits:**
- Layer types control their own instantiation
- Data extraction logic co-located with layer type
- Validation happens at layer type level
- Plot doesn't need to know layer-specific details

---

### 5. Registry Pattern (AxisRegistry)

**Intent:** Maintain a central registry of scales, prevent duplicates, enforce constraints.

**Implementation:**
- `AxisRegistry` stores all scales by name
- `ensureAxis()` creates or retrieves scales
- Unit validation prevents incompatible layers on same axis
- Created internally by Plot (not exposed to users)

**Benefits:**
- Single source of truth for scales
- Prevents unit mismatch bugs
- Lazy initialization (scales created on demand)
- Automatic lifecycle management

---

### 6. Separation of Concerns

**GPU Rendering (WebGL/regl):**
- Handles data visualization
- Executes shaders for each point
- Renders to canvas

**DOM Interaction (D3/SVG):**
- Handles axes, labels, ticks
- Manages zoom interactions
- Overlays on canvas

**Configuration (Declarative):**
- Data and layer specifications
- Domain overrides
- Margin and sizing

**Benefits:**
- GPU optimized for large datasets
- SVG provides crisp text rendering
- Independent update cycles
- Clear separation of responsibilities

---

## Key Architectural Decisions

### 1. Declarative API with Registry

**Decision:** Use layer type registry and declarative configuration

**Rationale:**
- More concise than imperative API
- Easier to serialize/deserialize
- Better schema introspection
- Clearer separation of concerns

**Trade-off:** Requires registration step, but only once per layer type

---

### 2. Auto Domain Calculation

**Decision:** Calculate domains from data by default, allow overrides

**Rationale:**
- Eliminates manual domain calculation
- Ensures data is visible by default
- Still allows explicit control when needed

**Trade-off:** Small performance cost on initialization, but negligible for typical datasets

---

### 3. Typed Arrays for GPU Efficiency

**Decision:** Require Float32Array for all data

**Rationale:**
- Direct GPU memory mapping (no CPU-side conversion)
- Matches GLSL float precision
- Memory efficient (4 bytes per value)

**Trade-off:** Slightly less convenient than regular arrays, but massive performance gain

---

### 4. Embedded Shaders

**Decision:** Store GLSL shaders as strings in LayerType instances

**Rationale:**
- Self-contained layer definitions
- No separate shader files to manage
- Easy to see vertex/fragment relationship

**Trade-off:** No syntax highlighting, but simplifies distribution

---

### 5. Canvas + SVG Overlay

**Decision:** Render data to canvas, axes to SVG

**Rationale:**
- WebGL excels at rendering large point clouds
- SVG provides crisp text and perfect lines
- SVG has `pointer-events: none` for some elements to allow canvas zoom

**Trade-off:** Two rendering contexts, but leverages strengths of each

---

### 6. Domain-Based Rendering

**Decision:** Normalize in GPU using domain uniforms, not CPU pre-processing

**Rationale:**
- Same data buffers valid at any zoom level
- No CPU-side coordinate transformation on zoom
- Smooth 60fps zoom without data copying

**Trade-off:** Slightly more complex shaders, but dramatically better performance

---

### 7. Multi-Axis Support

**Decision:** Support 4 axes (top/bottom x, left/right y) with independent scales

**Rationale:**
- Enables dual y-axis plots (different units/scales)
- Supports complex scientific visualizations
- Each layer can choose which axes to use

**Trade-off:** More complex axis management, but essential for scientific plotting

---

### 8. JSON Schema Support

**Decision:** Layer types provide JSON Schema for their parameters

**Rationale:**
- Enables validation and documentation
- Supports tooling and code generation
- Industry-standard schema format (Draft 2020-12)
- Plot can aggregate schemas for all registered types

**Trade-off:** Extra method to implement, but provides valuable introspection

---

## Performance Considerations

### GPU Rendering
- **Complexity:** O(n) for n points, GPU-accelerated
- **Bottleneck:** Fragment shader fill rate for overlapping points
- **Optimization:** Point size kept small (4.0 pixels)

### Initialization
- **Domain Calculation:** O(n) for n points per axis, CPU-side
- **Optimization:** Single pass per axis, leveraging typed array efficiency
- **Impact:** Negligible for typical datasets (<1M points)

### Zoom Handling
- **Complexity:** O(4) - updates up to 4 axis scales
- **Optimization:** Render called once per zoom event, not per axis
- **Smoothness:** Relies on requestAnimationFrame for 60fps

### Memory Usage
- **Data Storage:** Float32Array uses 4 bytes per value
- **GPU Buffers:** regl creates GPU buffers from typed arrays
- **No Copying:** Data stays in typed arrays, no duplication
- **Configuration:** Minimal overhead for layer specs and registry

### No Virtual Scrolling
- **Assumption:** Dataset fits in GPU memory
- **Limitation:** Very large datasets (>1M points) may need chunking
- **Current:** Example uses 5000 points, renders smoothly

---

## Extensibility Points

### Adding New LayerTypes

1. Create a LayerType instance with shaders, schema, and factory:

```javascript
import { LayerType, Layer } from './src/index.js'

const myLayerType = new LayerType({
  name: "mytype",
  xUnit: "meters",
  yUnit: "volts",
  vert: `/* custom vertex shader */`,
  frag: `/* custom fragment shader */`,
  attributes: {
    x: { buffer: (ctx, props) => props.data.x },
    y: { buffer: (ctx, props) => props.data.y }
  },
  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" }
    },
    required: ["xData", "yData"]
  }),
  createLayer: function(params, data) {
    return new Layer({
      type: this,
      data: { x: data[params.xData], y: data[params.yData] },
      xAxis: params.xAxis || "xaxis_bottom",
      yAxis: params.yAxis || "yaxis_left"
    })
  }
})
```

2. Register it:

```javascript
import { registerLayerType } from './src/index.js'
registerLayerType("mytype", myLayerType)
```

3. Use it declaratively:

```javascript
const plot = new Plot({
  container: document.getElementById("plot-container"),
  width: 800,
  height: 600,
  data: { myX, myY },
  plot: {
    layers: [
      { mytype: { xData: "myX", yData: "myY" } }
    ]
  }
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

### Schema Introspection

Get the complete schema for all registered layer types:

```javascript
import { Plot } from './src/index.js'
const schema = Plot.schema()
console.log(JSON.stringify(schema, null, 2))
```

This enables:
- Automatic validation of layer configurations
- Code generation for layer builders
- Documentation generation
- IDE autocomplete support

---

## Future Considerations

Potential enhancements that maintain the current architecture:

1. **WebGL2:** Upgrade to regl with WebGL2 context for instancing
2. **Layer Groups:** Add layer grouping for batch show/hide
3. **Animation:** Add time-based attribute updates
4. **Selection:** Add GPU-based point picking
5. **Textures:** Add texture-based colormaps for more complex gradients
6. **Validation:** Runtime validation using JSON Schema
7. **Serialization:** Save/load plot configurations as JSON

All can be added without breaking current API or architecture.
