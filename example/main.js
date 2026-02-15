import { Plot, Layer, AxisRegistry, scatterLayerType } from "../src/index.js"

const N = 5000
const x = new Float32Array(N)
const y = new Float32Array(N)
const v = new Float32Array(N)
for (let i=0;i<N;i++){
  x[i]=Math.random()*100
  y[i]=Math.random()*50
  v[i]=Math.random()
}

const scatterLayer = new Layer({
  type: scatterLayerType,
  data:{x,y,v},
  xAxis:"xaxis_bottom",
  yAxis:"yaxis_left"
})

const canvas = document.getElementById("canvas")
const svg = document.getElementById("svg")

const plot = new Plot({ canvas, svg, width:800, height:600 })
const axisRegistry = new AxisRegistry(800,600)
plot.setAxisRegistry(axisRegistry)

plot.addLayer(scatterLayer)

// Set initial domains
axisRegistry.getScale("xaxis_bottom").domain([0,100])
axisRegistry.getScale("yaxis_left").domain([0,50])

plot.render()
