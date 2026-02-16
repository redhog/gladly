import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

export const scatterLayerType = new LayerType({
  name: "scatter",
  axisQuantityUnits: {x: null, y: null},
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
  schema: (data) => {
    const dataProperties = data ? Object.keys(data) : []
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        xData: {
          type: "string",
          enum: dataProperties,
          description: "Property name in data object for x coordinates"
        },
        yData: {
          type: "string",
          enum: dataProperties,
          description: "Property name in data object for y coordinates"
        },
        vData: {
          type: "string",
          enum: dataProperties,
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
    }
  },
  getAxisQuantityUnits: function(parameters, data) {
    const { xData, yData } = parameters
    return { x: xData, y: yData }
  },
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

    // Return layer configuration (Layer construction and unit resolution handled automatically)
    return {
      attributes: { x, y, v },
      uniforms: {},
      xAxis,
      yAxis
    }
  }
})
registerLayerType("scatter", scatterLayerType)
