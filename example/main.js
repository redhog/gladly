import { Plot, Layer, AxisRegistry, LayerType } from "../src/index.js"

// Helper to create property accessor (repl regl.prop which may not be available)
const prop = (path) => (context, props) => {
  const parts = path.split('.')
  let value = props
  for (const part of parts) value = value[part]
  return value
}

// LayerType 1: meters (x) vs volts (y) - blue to red colormap
const layerType1 = new LayerType({
  name: "scatter-mv",
  xUnit: "meters",
  yUnit: "volts",
  attributes: {
    x: { buffer: prop("data.x") },
    y: { buffer: prop("data.y") },
    v: { buffer: prop("data.v") }
  },
  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float v;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    varying float value;
    void main() {
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 5.0;
      value = v;
    }
  `,
  frag: `
    precision mediump float;
    varying float value;
    vec3 colormap(float t){ return vec3(t, 0.0, 1.0-t); }  // Blue to red
    void main(){ gl_FragColor=vec4(colormap(value), 1.0); }
  `
})

// LayerType 2: m/s (x) vs ampere (y) - green to yellow colormap
const layerType2 = new LayerType({
  name: "scatter-sa",
  xUnit: "m/s",
  yUnit: "ampere",
  attributes: {
    x: { buffer: prop("data.x") },
    y: { buffer: prop("data.y") },
    v: { buffer: prop("data.v") }
  },
  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float v;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    varying float value;
    void main() {
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 5.0;
      value = v;
    }
  `,
  frag: `
    precision mediump float;
    varying float value;
    vec3 colormap(float t){ return vec3(0.0, 0.5+t*0.5, 1.0-t); }  // Green to yellow
    void main(){ gl_FragColor=vec4(colormap(value), 1.0); }
  `
})

const N = 500

// First sine curve: meters (0-10) vs volts (0-5)
// y = 2.5 + 2*sin(x) + random error
const x1 = new Float32Array(N)
const y1 = new Float32Array(N)
const v1 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 10  // 0 to 10 meters
  x1[i] = xVal
  y1[i] = 2.5 + 2 * Math.sin(xVal * 0.8) + (Math.random() - 0.5) * 0.5  // 0-5 volts range
  v1[i] = (Math.sin(xVal * 2) + 1) / 2  // Color: sin with 2x frequency, mapped to [0,1]
}

// Second sine curve: m/s (0-100) vs ampere (10-50)
// y = 30 + 15*sin(x) + random error
const x2 = new Float32Array(N)
const y2 = new Float32Array(N)
const v2 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 100  // 0 to 100 m/s
  x2[i] = xVal
  y2[i] = 30 + 15 * Math.sin(xVal * 0.1) + (Math.random() - 0.5) * 2  // 10-50 ampere range
  v2[i] = (Math.cos(xVal * 0.15) + 1) / 2  // Color: cos, mapped to [0,1]
}

const layer1 = new Layer({
  type: layerType1,
  data: {x: x1, y: y1, v: v1},
  xAxis: "xaxis_bottom",  // Bottom axis
  yAxis: "yaxis_left"     // Left axis
})

const layer2 = new Layer({
  type: layerType2,
  data: {x: x2, y: y2, v: v2},
  xAxis: "xaxis_top",     // Top axis
  yAxis: "yaxis_right"    // Right axis
})

const canvas = document.getElementById("canvas")
const svg = document.getElementById("svg")

const plot = new Plot({ canvas, svg, width: 800, height: 600 })
const axisRegistry = new AxisRegistry(plot.plotWidth, plot.plotHeight)
plot.setAxisRegistry(axisRegistry)

plot.addLayer(layer1)
plot.addLayer(layer2)

// Set initial domains for all four axes
axisRegistry.getScale("xaxis_bottom").domain([0, 10])      // meters
axisRegistry.getScale("yaxis_left").domain([0, 5])         // volts
axisRegistry.getScale("xaxis_top").domain([0, 100])        // m/s
axisRegistry.getScale("yaxis_right").domain([10, 50])      // ampere

plot.render()
