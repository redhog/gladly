import { LayerType, Layer, registerLayerType } from "../../src/index.js"

/**
 * Scatter plot layer type for meters (x) vs volts (y)
 * Uses blue to red colormap
 */
export const ScatterMVLayer = new LayerType({
  name: "scatter-mv",
  axisQuantityUnits: {x: "meters", y: "volts"},
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
    type: "object",
    title: "Scatter (Meters/Volts)",
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
    const resolved = this.resolveAxisQuantityUnits(parameters, data)
    return new Layer({
      type: this,
      attributes: { x: data[xData], y: data[yData], v: data[vData] },
      uniforms: {},
      xAxis,
      yAxis,
      xAxisQuantityUnit: resolved.x,
      yAxisQuantityUnit: resolved.y
    })
  }
})

registerLayerType("scatter-mv", ScatterMVLayer)
