import { LayerType, registerLayerType } from "../../src/index.js"

/**
 * Scatter plot layer type for m/s (x) vs ampere (y)
 * Uses coolwarm colorscale
 */
export const ScatterSALayer = new LayerType({
  name: "scatter-sa",
  axisQuantityUnits: {x: "meters", y: "ampere"},
  colorAxisQuantityKinds: { v: null },
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
    uniform int colorscale_v;
    uniform vec2 color_range_v;
    varying float value;
    void main() {
      gl_FragColor = map_color(colorscale_v, color_range_v, value);
    }
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
  getColorAxisQuantityKinds: function(parameters) {
    return { v: parameters.vData }
  },
  createLayer: function(parameters, data) {
    const { xData, yData, vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    const v = data[vData]
    return {
      attributes: { x: data[xData], y: data[yData], v },
      uniforms: {},
      xAxis,
      yAxis,
      colorAxes: { v: { quantityKind: vData, data: v, colorscale: "coolwarm" } }
    }
  }
})

registerLayerType("scatter-sa", ScatterSALayer)
