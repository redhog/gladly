import { Plot, LayerType, Layer, registerLayerType } from "../src/index.js"

// Helper to create property accessor (repl regl.prop which may not be available)
const prop = (path) => (context, props) => {
  const parts = path.split('.')
  let value = props
  for (const part of parts) value = value[part]
  return value
}

// Define LayerType 1: meters (x) vs volts (y) - blue to red colormap
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
    vec3 colormap(float t){ return vec3(t, 0.0, 1.0-t); }
    void main(){ gl_FragColor=vec4(colormap(value), 1.0); }
  `,
  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      vData: { type: "string" },
      xAxis: { type: "string", default: "xaxis_bottom" },
      yAxis: { type: "string", default: "yaxis_left" }
    },
    required: ["xData", "yData", "vData"]
  }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return new Layer({
      type: this,
      data: { x: data[xData], y: data[yData], v: data[vData] },
      xAxis,
      yAxis
    })
  }
})

// Define LayerType 2: m/s (x) vs ampere (y) - green to yellow colormap
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
    vec3 colormap(float t){ return vec3(0.0, 0.5+t*0.5, 1.0-t); }
    void main(){ gl_FragColor=vec4(colormap(value), 1.0); }
  `,
  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: { type: "string" },
      yData: { type: "string" },
      vData: { type: "string" },
      xAxis: { type: "string", default: "xaxis_bottom" },
      yAxis: { type: "string", default: "yaxis_left" }
    },
    required: ["xData", "yData", "vData"]
  }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return new Layer({
      type: this,
      data: { x: data[xData], y: data[yData], v: data[vData] },
      xAxis,
      yAxis
    })
  }
})

// Register layer types
registerLayerType("scatter-mv", layerType1)
registerLayerType("scatter-sa", layerType2)

const N = 500

// First sine curve: meters (0-10) vs volts (0-5)
const x1 = new Float32Array(N)
const y1 = new Float32Array(N)
const v1 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 10
  x1[i] = xVal
  y1[i] = 2.5 + 2 * Math.sin(xVal * 0.8) + (Math.random() - 0.5) * 0.5
  v1[i] = (Math.sin(xVal * 2) + 1) / 2
}

// Second sine curve: m/s (0-100) vs ampere (10-50)
const x2 = new Float32Array(N)
const y2 = new Float32Array(N)
const v2 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 100
  x2[i] = xVal
  y2[i] = 30 + 15 * Math.sin(xVal * 0.1) + (Math.random() - 0.5) * 2
  v2[i] = (Math.cos(xVal * 0.15) + 1) / 2
}

const canvas = document.getElementById("canvas")
const svg = document.getElementById("svg")

// Create plot with declarative API
const plot = new Plot({
  canvas,
  svg,
  width: 800,
  height: 600,
  data: { x1, y1, v1, x2, y2, v2 },
  layers: [
    { "scatter-mv": { xData: "x1", yData: "y1", vData: "v1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
    { "scatter-sa": { xData: "x2", yData: "y2", vData: "v2", xAxis: "xaxis_top", yAxis: "yaxis_right" } }
  ],
  axes: {
    xaxis_bottom: [0, 10],
    yaxis_left: [0, 5]
    // xaxis_top and yaxis_right will be auto-calculated from data
  }
})

// Log the schema for demonstration
console.log("Layer schema:", JSON.stringify(Plot.schema(), null, 2))
