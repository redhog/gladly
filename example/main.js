import { Plot, Layer, AxisRegistry, scatterLayerType } from "../src/index.js"

const N = 500

// First sine curve: y = sin(x) + random error
const x1 = new Float32Array(N)
const y1 = new Float32Array(N)
const v1 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 4 * Math.PI  // 0 to 4π
  x1[i] = xVal
  y1[i] = Math.sin(xVal) + (Math.random() - 0.5) * 0.4  // sin(x) ± random error
  v1[i] = (Math.sin(xVal * 2) + 1) / 2  // Color: sin with 2x frequency, mapped to [0,1]
}

// Second sine curve: y = sin(x) - random error (or with phase shift)
const x2 = new Float32Array(N)
const y2 = new Float32Array(N)
const v2 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 4 * Math.PI  // 0 to 4π
  x2[i] = xVal
  y2[i] = Math.sin(xVal + Math.PI/4) + (Math.random() - 0.5) * 0.4  // sin(x + π/4) ± random error
  v2[i] = (Math.sin(xVal * 3 + Math.PI/3) + 1) / 2  // Color: sin with 3x frequency, mapped to [0,1]
}

const scatterLayer1 = new Layer({
  type: scatterLayerType,
  data: {x: x1, y: y1, v: v1},
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left"
})

const scatterLayer2 = new Layer({
  type: scatterLayerType,
  data: {x: x2, y: y2, v: v2},
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left"
})

const canvas = document.getElementById("canvas")
const svg = document.getElementById("svg")

const plot = new Plot({ canvas, svg, width:800, height:600 })
const axisRegistry = new AxisRegistry(800,600)
plot.setAxisRegistry(axisRegistry)

plot.addLayer(scatterLayer1)
plot.addLayer(scatterLayer2)

// Set initial domains
axisRegistry.getScale("xaxis_bottom").domain([0, 4 * Math.PI])
axisRegistry.getScale("yaxis_left").domain([-2, 2])

plot.render()
