# Quick Start

## Installation

### From npm

```bash
npm install gladly-plot
```

```javascript
import { Plot, registerLayerType, scatterLayerType } from 'gladly-plot'
```

### From source

Clone the repository, then:

```bash
npm install regl d3
```

```javascript
import { Plot, registerLayerType, scatterLayerType } from './src/index.js'
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
import { Plot, registerLayerType, scatterLayerType } from 'gladly-plot'

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

## Next steps

- **[Configuring Plots](api/PlotConfiguration.md)** — axes config, auto-range, multi-layer, interaction
- **[Writing Layer Types](api/LayerTypes.md)** — custom shaders, color axes, filter axes
- **[API Reference](api/Reference.md)** — full reference for `Plot`, `linkAxes`, `registerLayerType`, and more
