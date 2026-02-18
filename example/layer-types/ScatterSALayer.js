import { LayerType, registerLayerType } from "../../src/index.js"

/**
 * Scatter plot layer type for distance (x) vs current (y)
 * Uses coolwarm colorscale. Supports an optional filter axis (fData).
 */
export const ScatterSALayer = new LayerType({
  name: "scatter-sa",
  axisQuantityKinds: {x: "distance_m", y: "current_A"},
  colorAxisQuantityKinds: ["temperature_K"],
  filterAxisQuantityKinds: ["velocity_ms"],
  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float v;
    attribute float f;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform vec4 filter_range_f;
    varying float value;
    void main() {
      if (!filter_in_range(filter_range_f, f)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
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
    title: "Scatter (Distance/Current)",
    properties: {
      xData: { type: "string", title: "X Data Property", description: "Property name for x coordinates" },
      yData: { type: "string", title: "Y Data Property", description: "Property name for y coordinates" },
      vData: { type: "string", title: "Color Data Property", description: "Property name for color values" },
      fData: { type: "string", title: "Filter Data Property", description: "Property name for filter values (tan(x*0.1) by default)" },
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
    required: ["xData", "yData", "vData", "fData"]
  }),
  createLayer: function(parameters, data) {
    const { xData, yData, vData, fData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    const v = data[vData]
    const f = data[fData]
    return {
      attributes: { x: data[xData], y: data[yData], v, f },
      uniforms: {},
      xAxis,
      yAxis,
      colorAxes: { v: { quantityKind: "temperature_K", data: v, colorscale: "coolwarm" } },
      filterAxes: { f: { quantityKind: "velocity_ms", data: f } }
    }
  }
})

registerLayerType("scatter-sa", ScatterSALayer)
