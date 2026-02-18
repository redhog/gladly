import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

export const scatterLayerType = new LayerType({
  name: "scatter",

  getAxisConfig: function(parameters) {
    const { xData, yData, vData, xAxis, yAxis } = parameters
    return {
      xAxis,
      xAxisQuantityKind: xData,
      yAxis,
      yAxisQuantityKind: yData,
      colorAxisQuantityKinds: [vData],
    }
  },

  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float %%color0%%;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    varying float value;
    void main() {
      float xVal = xScaleType > 0.5 ? log(x) : x;
      float yVal = yScaleType > 0.5 ? log(y) : y;
      float nx = (xVal - xDomain.x) / (xDomain.y - xDomain.x);
      float ny = (yVal - yDomain.x) / (yDomain.y - yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 4.0;
      value = %%color0%%;
    }
  `,
  frag: `
    precision mediump float;
    uniform int colorscale_%%color0%%;
    uniform vec2 color_range_%%color0%%;
    uniform float color_scale_type_%%color0%%;
    varying float value;
    void main() {
      float v = color_scale_type_%%color0%% > 0.5 ? log(value) : value;
      gl_FragColor = map_color(colorscale_%%color0%%, color_range_%%color0%%, v);
    }
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
          description: "Property name in data object for color values; also used as the color axis quantity kind"
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
  createLayer: function(parameters, data) {
    const { xData, yData, vData } = parameters

    const x = data[xData]
    const y = data[yData]
    const v = data[vData]

    if (!x) throw new Error(`Data property '${xData}' not found in data object`)
    if (!y) throw new Error(`Data property '${yData}' not found in data object`)
    if (!v) throw new Error(`Data property '${vData}' not found in data object`)

    return {
      attributes: { x, y, [vData]: v },
      uniforms: {},
    }
  }
})
registerLayerType("scatter", scatterLayerType)
