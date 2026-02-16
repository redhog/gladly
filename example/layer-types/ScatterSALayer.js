import { LayerType, Layer } from "../../src/index.js"
import { prop } from "../utils.js"

/**
 * Scatter plot layer type for m/s (x) vs ampere (y)
 * Uses green to yellow colormap
 */
export const ScatterSALayer = new LayerType({
  name: "scatter-sa",
  xAxisQuantityUnit: "m/s",
  yAxisQuantityUnit: "ampere",
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
    type: "object",
    title: "Scatter (Speed/Ampere)",
    properties: {
      xData: { type: "string", title: "X Data Property", description: "Property name for x coordinates" },
      yData: { type: "string", title: "Y Data Property", description: "Property name for y coordinates" },
      vData: { type: "string", title: "Color Data Property", description: "Property name for color values" },
      xAxis: {
        type: "string",
        title: "X Axis",
        enum: ["xaxis_bottom", "xaxis_top"],
        default: "xaxis_bottom"
      },
      yAxis: {
        type: "string",
        title: "Y Axis",
        enum: ["yaxis_left", "yaxis_right"],
        default: "yaxis_left"
      }
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
