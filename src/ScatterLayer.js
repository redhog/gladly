import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { registerLayerType } from "./LayerTypeRegistry.js"
import { Data } from "./Data.js"

export const scatterLayerType = new LayerType({
  name: "scatter",

  getAxisConfig: function(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, xAxis, yAxis } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
      colorAxisQuantityKinds: [d.getQuantityKind(vData) ?? vData],
    }
  },

  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float color_data;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    varying float value;
    void main() {
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 4.0;
      value = color_data;
    }
  `,
  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    varying float value;
    void main() {
      gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type);
    }
  `,
  schema: (data) => {
    const dataProperties = Data.wrap(data).columns()
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
    const d = Data.wrap(data)
    const { xData, yData, vData } = parameters

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData
    const vQK = d.getQuantityKind(vData) ?? vData

    const x = d.getData(xData)
    const y = d.getData(yData)
    const v = d.getData(vData)

    if (!x) throw new Error(`Data column '${xData}' not found`)
    if (!y) throw new Error(`Data column '${yData}' not found`)
    if (!v) throw new Error(`Data column '${vData}' not found`)

    const domains = {}
    const xDomain = d.getDomain(xData)
    const yDomain = d.getDomain(yData)
    const vDomain = d.getDomain(vData)
    if (xDomain) domains[xQK] = xDomain
    if (yDomain) domains[yQK] = yDomain
    if (vDomain) domains[vQK] = vDomain

    return [{
      attributes: { x, y, [vQK]: v },
      uniforms: {},
      domains,
      nameMap: {
        [vQK]: 'color_data',
        [`colorscale_${vQK}`]: 'colorscale',
        [`color_range_${vQK}`]: 'color_range',
        [`color_scale_type_${vQK}`]: 'color_scale_type',
      },
    }]
  }
})
registerLayerType("scatter", scatterLayerType)
