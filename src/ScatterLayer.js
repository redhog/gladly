import { LayerType } from "./LayerType.js"
import { Layer } from "./Layer.js"
import { AXES } from "./AxisRegistry.js"

// Helper to create property accessor (repl regl.prop which may not be available)
const prop = (path) => (context, props) => {
  const parts = path.split('.')
  let value = props
  for (const part of parts) value = value[part]
  return value
}

export const scatterLayerType = new LayerType({
  name: "scatter",
  xAxisQuantityUnit: "meters",
  yAxisQuantityUnit: "meters",
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
      gl_PointSize = 4.0;
      value = v;
    }
  `,
  frag: `
    precision mediump float;
    varying float value;
    vec3 colormap(float t){ return vec3(t,0.0,1.0-t); }
    void main(){ gl_FragColor=vec4(colormap(value),1.0); }
  `,
  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xData: {
        type: "string",
        description: "Property name in data object for x coordinates"
      },
      yData: {
        type: "string",
        description: "Property name in data object for y coordinates"
      },
      vData: {
        type: "string",
        description: "Property name in data object for color values"
      },
      xAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("x")),
        default: "xaxis_bottom",
        description: "Which x-axis to use for this layer"
      },
      yAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("y")),
        default: "yaxis_left",
        description: "Which y-axis to use for this layer"
      }
    },
    required: ["xData", "yData", "vData"]
  }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters

    // Extract data from the data object
    const x = data[xData]
    const y = data[yData]
    const v = data[vData]

    // Validate that data exists
    if (!x) throw new Error(`Data property '${xData}' not found in data object`)
    if (!y) throw new Error(`Data property '${yData}' not found in data object`)
    if (!v) throw new Error(`Data property '${vData}' not found in data object`)

    // Create and return the layer
    return new Layer({
      type: this,
      data: { x, y, v },
      xAxis,
      yAxis
    })
  }
})
