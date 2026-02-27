# Data Flow & Rendering

This page describes how data moves through Gladly at runtime: the declarative setup phase, the per-frame render cycle, and the zoom/pan interaction cycle. For module internals see [Modules.md](Modules.md). For the high-level picture see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Declarative Setup Phase

```
1. Register layer types (once at startup)
   └─> registerLayerType("points", pointsLayerType)  // side-effect import of PointsLayer.js
       └─> registerLayerType("lines", linesLayerType)   // side-effect import of LinesLayer.js
           └─> LayerTypeRegistry.set(...)

2. Prepare data
   └─> const data = { x: Float32Array, y: Float32Array, v: Float32Array }

3. Create Plot
   new Plot(container)
   ├─> Creates <canvas> and appends to container
   ├─> Creates <svg> and appends to container
   ├─> Attaches ResizeObserver (calls update({}) on resize)
   └─> No rendering yet — waits for update()

4. plot.update({ config, data })
   ├─> Stores config and data
   ├─> Reads width/height from container.clientWidth / clientHeight
   ├─> Sets canvas and SVG dimensions
   ├─> Destroys previous regl context if present
   ├─> Clears SVG content
   └─> Calls Plot._initialize()
```

### `Plot._initialize()`

```
Plot._initialize()
  │
  ├─> Initialise regl WebGL context on canvas
  ├─> Create AxisRegistry(width, height)
  ├─> Create ColorAxisRegistry
  ├─> Create FilterAxisRegistry
  │
  ├─> Plot._processLayers(config.layers, data)
  │   │
  │   └─> For each { typeName: parameters } in layers:
  │       │
  │       ├─> LayerTypeRegistry.get(typeName)
  │       │
  │       ├─> layerType.createLayer(parameters, data)
  │       │   ├─> User createLayer: extract Float32Arrays, return config object
  │       │   ├─> resolveAxisQuantityKinds()  — merge static + getAxisQuantityKinds()
  │       │   ├─> resolveColorAxisQuantityKinds()
  │       │   ├─> resolveFilterAxisQuantityKinds()
  │       │   └─> Construct Layer instance (validates Float32Arrays)
  │       │
  │       ├─> AxisRegistry.ensureAxis(layer.xAxis, layer.xAxisQuantityKind)
  │       │   └─> Create D3 scale if new; throw if quantity kind conflicts
  │       ├─> AxisRegistry.ensureAxis(layer.yAxis, layer.yAxisQuantityKind)
  │       │
  │       ├─> ColorAxisRegistry.ensureColorAxis(quantityKind) — per color slot
  │       ├─> FilterAxisRegistry.ensureFilterAxis(quantityKind) — per filter slot
  │       │
  │       └─> layerType.createDrawCommand(regl, layer)
  │           ├─> Inject map_color() GLSL if color axes present
  │           ├─> Inject filter_in_range() GLSL if filter axes present
  │           ├─> Compile vertex + fragment shaders
  │           ├─> Build attributes map  { name: regl.prop('attributes.name') }
  │           ├─> Build uniforms map    { xDomain, yDomain, count,
  │           │                           colorscale_<slot>, color_range_<slot>,
  │           │                           filter_range_<slot> }
  │           └─> Return regl draw function
  │
  ├─> Plot._setDomains(config.axes)
  │   ├─> Spatial axes:
  │   │   └─> For each registered axis, collect attribute arrays from all layers;
  │   │       compute [min, max]; apply config override if present
  │   ├─> Filter axes:
  │   │   └─> For each registered filter axis, apply config min/max if present;
  │   │       default = open bounds (no discard)
  │   └─> Color axes:
  │       └─> For each registered quantity kind, scan all layer colorAxes[slot].data;
  │           compute [min, max]; apply config override; apply colorscale preference
  │
  ├─> Plot.initZoom()   — see Interaction Cycle below
  │
  └─> Plot.render()     — see Render Cycle below
```

---

## Render Cycle (per frame)

```
plot.render()
  │
  ├─> regl.clear({ color: [1, 1, 1, 1] })   — white background
  │
  ├─> For each (layer, drawCommand):
  │   │
  │   ├─> Collect props:
  │   │   ├─> xDomain  ← axisRegistry.scales[layer.xAxis].domain()
  │   │   ├─> yDomain  ← axisRegistry.scales[layer.yAxis].domain()
  │   │   ├─> viewport ← { x:0, y:0, width, height }
  │   │   ├─> count    ← layer.vertexCount ?? layer.attributes.x.length
  │   │   ├─> Per color slot:
  │   │   │     colorscale_<slot>  ← colorAxisRegistry.getIndex(quantityKind)
  │   │   │     color_range_<slot> ← colorAxisRegistry.getRange(quantityKind)
  │   │   └─> Per filter slot:
  │   │         filter_range_<slot> ← filterAxisRegistry.getVec4(quantityKind)
  │   │           → vec4 [min, max, hasMin, hasMax]
  │   │
  │   └─> drawCommand(props)
  │       │
  │       └─> GPU execution:
  │           ├─> Vertex shader (once per data point):
  │           │   ├─> Read attribute values (x, y, v, z, …)
  │           │   ├─> Optionally: filter_in_range() → move to clip discard position
  │           │   ├─> Normalise to clip space using xDomain / yDomain
  │           │   └─> Write gl_Position, gl_PointSize, varyings
  │           │
  │           └─> Fragment shader (once per rasterised pixel):
  │               ├─> Optionally: discard via filter_in_range()
  │               ├─> map_color() → look up colorscale, normalise value → RGBA
  │               └─> Write gl_FragColor
  │
  ├─> plot.renderAxes()
  │   └─> For each axis in AxisRegistry:
  │       ├─> Create D3 axis generator (axisBottom / axisTop / axisLeft / axisRight)
  │       ├─> Select or create SVG <g> element, position with transform
  │       ├─> Call generator → draws ticks and tick labels
  │       └─> Add unit label <text>
  │
  └─> Fire all callbacks in Plot._renderCallbacks
      └─> e.g. Colorbar.render() re-syncs from target plot and re-renders
```

---

## Interaction Cycle (Zoom / Pan)

### Setup

```
plot.initZoom()
  ├─> Append full-coverage SVG <rect> (the zoom capture surface)
  ├─> Create D3 zoom behaviour:
  │   ├─> scaleExtent [0.5, 50]
  │   ├─> On wheel: zoom only (no translate)
  │   └─> On drag: pan (translate)
  └─> Attach zoom to SVG element
      └─> On each zoom event → _handleZoom(event)
```

### Plot-area zoom (all axes)

```
User scrolls / drags in the plot area
  │
  ├─> D3 zoom event fires
  ├─> Region detected: "plot_area"
  │
  ├─> For each of the four possible axes:
  │   ├─> Get current D3 scale
  │   ├─> Determine anchor: data value at mouse position (stays fixed under cursor)
  │   ├─> Apply scale factor / translate
  │   └─> Update scale domain
  │
  └─> plot.render()
```

### Axis-specific zoom

```
User scrolls / drags over an individual axis label area
  │
  ├─> D3 zoom event fires
  ├─> Region detected: e.g. "xaxis_bottom"
  │
  ├─> Get that axis's D3 scale
  ├─> Determine anchor at mouse position
  ├─> Apply transform to that scale only
  │
  └─> plot.render()
```

**Cursor-anchored zoom detail:**
The interaction tracks the mouse position at gesture start, computes the data value at that pixel, applies the zoom/scale transform, then shifts the domain so that data value maps back to the same pixel. This gives the intuitive "zoom around the cursor" effect independently on each axis.

---

## ResizeObserver Flow

```
Container element resized
  │
  └─> ResizeObserver callback fires
      └─> plot.update({})   (no new config or data)
          └─> Reads new clientWidth / clientHeight
              └─> _initialize() → full re-render at new size
```

No manual resize handling is needed.
