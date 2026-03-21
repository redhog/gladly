# Quick Start

## Installation

### Via CDN / script tag

Include the pre-built standalone bundle directly — no build step or npm required:

```html
<script src="https://redhog.github.io/gladly/dist/gladly.iife.min.js"></script>
<script>
  const plot = new Gladly.Plot(document.getElementById('plot-container'))
  // ...
</script>
```

Or use the ES module build with an import map or `<script type="module">`:

```html
<script type="module">
  import { Plot } from 'https://redhog.github.io/gladly/dist/gladly.esm.js'
  // ...
</script>
```

Unminified build also available at `https://redhog.github.io/gladly/dist/gladly.iife.js`.

### From npm

```bash
npm install gladly-plot
```

```javascript
import { Plot, pointsLayerType } from 'gladly-plot'
```

### From source

Clone the repository, then:

```bash
npm install regl d3
```

```javascript
import { Plot, pointsLayerType } from './src/index.js'
```

#### Run the built-in example

```bash
npm install
npm start
```

Open your browser to `http://localhost:1234` to see the demo.

## Minimal example

**HTML container:**
```html
<div id="plot-container" style="position: relative; width: 800px; height: 600px;"></div>
```

Width and height are auto-detected from `clientWidth`/`clientHeight` and update automatically via `ResizeObserver`.

**JavaScript:**
```javascript
import { Plot, pointsLayerType } from 'gladly-plot'

// 1. Register layer types once at startup
// pointsLayerType is auto-registered on import — no manual registerLayerType call needed

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
      { points: { xData: "x", yData: "y", vData: "v" } }
    ],
    axes: {
      xaxis_bottom: { min: 0, max: 60 },
      yaxis_left:   { min: 0, max: 50 }
    }
  }
})
```

## Understanding the Concepts

Before diving into configuration, read the **[Concepts](concepts/Overview.md)** guide for a conceptual overview of Gladly's data model — axes, quantity kinds, colorscales, layer types, and the data format.

## Next steps

- **[Configuring Plots](configuration/PlotConfiguration.md)** — axes config, auto-range, multi-layer, interaction
- **[Built-in Layer Types](configuration/BuiltInLayerTypes.md)** — points, lines, bars, histogram, tile, colorbar, filterbar
- **[Computations](configuration/Computations.md)** — transforms and computed attributes
- **[Writing Layer Types](extension-api/LayerTypes.md)** — custom shaders, color axes, filter axes
- **[User API](user-api/overview.md)** — full reference for `Plot`, `linkAxes`, `Data`, and more
