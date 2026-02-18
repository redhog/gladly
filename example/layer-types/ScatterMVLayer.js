import { LayerType, registerLayerType } from "../../src/index.js"

/**
 * Scatter plot layer type for distance (x) vs voltage (y)
 * Uses plasma colorscale. Supports an optional filter axis (fData).
 */
export const ScatterMVLayer = new LayerType({
  name: "scatter-mv",
  // Static declarations for schema/introspection (no parameters needed to read these)
  xAxis: "xaxis_bottom",
  xAxisQuantityKind: "distance_m",
  yAxis: "yaxis_left",
  yAxisQuantityKind: "voltage_V",
  colorAxisQuantityKinds: ["reflectance_au"],
  filterAxisQuantityKinds: ["incidence_angle_rad"],

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
    attribute float reflectance_au;
    attribute float incidence_angle_rad;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    uniform vec4 filter_range_incidence_angle_rad;
    varying float value;
    void main() {
      if (!filter_in_range(filter_range_incidence_angle_rad, incidence_angle_rad)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 5.0;
      value = reflectance_au;
    }
  `,
  frag: `
    precision mediump float;
    uniform int colorscale_reflectance_au;
    uniform vec2 color_range_reflectance_au;
    uniform float color_scale_type_reflectance_au;
    varying float value;
    void main() {
      gl_FragColor = map_color_s(colorscale_reflectance_au, color_range_reflectance_au, value, color_scale_type_reflectance_au);
    }
  `,
  schema: () => ({
    type: "object",
    title: "Scatter (Distance/Voltage)",
    properties: {
      xData: { type: "string", title: "X Data Property", description: "Property name for x coordinates (distance_m)" },
      yData: { type: "string", title: "Y Data Property", description: "Property name for y coordinates (voltage_V)" },
      vData: { type: "string", title: "Color Data Property", description: "Property name for color values (reflectance_au)" },
      fData: { type: "string", title: "Filter Data Property", description: "Property name for filter values (incidence_angle_rad)" },
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
    const { xData, yData, vData, fData } = parameters
    return [{
      attributes: {
        x: data[xData],
        y: data[yData],
        reflectance_au: data[vData],
        incidence_angle_rad: data[fData],
      },
      uniforms: {},
    }]
  }
})

registerLayerType("scatter-mv", ScatterMVLayer)
