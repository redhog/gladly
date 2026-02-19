import { LayerType, registerLayerType, Data } from "../../src/index.js"

/**
 * Scatter plot layer type for distance (x) vs current (y)
 * Uses coolwarm colorscale. Supports an optional filter axis (fData).
 */
export const ScatterSALayer = new LayerType({
  name: "scatter-sa",
  // Static declarations for schema/introspection (no parameters needed to read these)
  xAxis: "xaxis_bottom",
  xAxisQuantityKind: "distance_m",
  yAxis: "yaxis_left",
  yAxisQuantityKind: "current_A",
  colorAxisQuantityKinds: ["temperature_K"],
  filterAxisQuantityKinds: ["velocity_ms"],

  getAxisConfig: function(parameters) {
    return {
      xAxis: parameters.xAxis,
      yAxis: parameters.yAxis,
    }
  },

  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float temperature_K;
    attribute float velocity_ms;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    uniform vec4 filter_range_velocity_ms;
    varying float value;
    void main() {
      if (!filter_in_range(filter_range_velocity_ms, velocity_ms)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 5.0;
      value = temperature_K;
    }
  `,
  frag: `
    precision mediump float;
    uniform int colorscale_temperature_K;
    uniform vec2 color_range_temperature_K;
    uniform float color_scale_type_temperature_K;
    varying float value;
    void main() {
      gl_FragColor = map_color_s(colorscale_temperature_K, color_range_temperature_K, value, color_scale_type_temperature_K);
    }
  `,
  schema: () => ({
    type: "object",
    title: "Scatter (Distance/Current)",
    properties: {
      xData: { type: "string", title: "X Data Property", description: "Property name for x coordinates (distance_m)" },
      yData: { type: "string", title: "Y Data Property", description: "Property name for y coordinates (current_A)" },
      vData: { type: "string", title: "Color Data Property", description: "Property name for color values (temperature_K)" },
      fData: { type: "string", title: "Filter Data Property", description: "Property name for filter values (velocity_ms)" },
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
    const d = Data.wrap(data)
    const { xData, yData, vData, fData } = parameters
    return [{
      attributes: {
        x: d.getData(xData),
        y: d.getData(yData),
        temperature_K: d.getData(vData),
        velocity_ms: d.getData(fData),
      },
      uniforms: {},
    }]
  }
})

registerLayerType("scatter-sa", ScatterSALayer)
