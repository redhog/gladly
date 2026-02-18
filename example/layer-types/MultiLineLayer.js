import { LayerType } from "../../src/LayerType.js"
import { registerLayerType } from "../../src/LayerTypeRegistry.js"
import { AXES } from "../../src/AxisRegistry.js"

export const multiLineLayerType = new LayerType({
  name: "multi-line",
  primitive: "lines",

  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left",
  colorAxisQuantityKinds: ["line_index"],

  getAxisConfig: function(parameters) {
    const { xData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      xAxis,
      xAxisQuantityKind: xData,
      yAxis,
    }
  },

  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float line_index;
    attribute float bad_segment;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    varying float vLineIndex;
    varying float vBadSegment;
    void main() {
      float nx = normalize_axis(x, xDomain, xScaleType);
      float ny = normalize_axis(y, yDomain, yScaleType);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      vLineIndex = line_index;
      vBadSegment = bad_segment;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    uniform vec4 bad_color;
    varying float vLineIndex;
    varying float vBadSegment;
    void main() {
      if (vBadSegment > 0.5) {
        gl_FragColor = bad_color;
      } else {
        gl_FragColor = map_color_s(colorscale, color_range, vLineIndex, color_scale_type);
      }
    }
  `,

  schema: (data) => {
    const dataProperties = data ? Object.keys(data) : []
    return {
      type: "object",
      title: "Multi-line plot",
      properties: {
        xData: {
          type: "string",
          enum: dataProperties,
          description: "Column to use as x axis; all other columns become lines"
        },
        filterData: {
          type: "string",
          enum: dataProperties,
          description: "Optional column for quality filtering; segments where filter > cutoff are drawn in badColor"
        },
        cutoff: {
          type: "number",
          default: 0,
          description: "Threshold above which filter column marks a segment as bad"
        },
        badColor: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          default: [0.5, 0.5, 0.5, 1.0],
          description: "RGBA color for bad (filtered) segments"
        },
        xAxis: {
          type: "string",
          enum: AXES.filter(a => a.includes("x")),
          default: "xaxis_bottom"
        },
        yAxis: {
          type: "string",
          enum: AXES.filter(a => a.includes("y")),
          default: "yaxis_left"
        }
      },
      required: ["xData"]
    }
  },

  createLayer: function(parameters, data) {
    const {
      xData,
      filterData,
      cutoff = 0,
      badColor = [0.5, 0.5, 0.5, 1.0],
    } = parameters

    const xArr = data[xData]
    if (!xArr) throw new Error(`Data property '${xData}' not found`)
    const filterArr = filterData ? data[filterData] : null
    const N = xArr.length
    const nSegs = N - 1

    const yColumns = Object.keys(data).filter(k => k !== xData && k !== filterData)

    return yColumns.map((colName, idx) => {
      const yArr = data[colName]
      const xs      = new Float32Array(nSegs * 2)
      const ys      = new Float32Array(nSegs * 2)
      const lineIdx = new Float32Array(nSegs * 2)
      const badSeg  = new Float32Array(nSegs * 2)

      for (let i = 0; i < nSegs; i++) {
        xs[i*2]     = xArr[i];      xs[i*2+1]     = xArr[i+1]
        ys[i*2]     = yArr[i];      ys[i*2+1]     = yArr[i+1]
        lineIdx[i*2] = idx;         lineIdx[i*2+1] = idx
        const isBad = filterArr !== null && (filterArr[i] > cutoff || filterArr[i+1] > cutoff)
        badSeg[i*2]  = isBad ? 1.0 : 0.0
        badSeg[i*2+1] = isBad ? 1.0 : 0.0
      }

      return {
        attributes: { x: xs, y: ys, line_index: lineIdx, bad_segment: badSeg },
        uniforms: { bad_color: badColor },
        domains: { line_index: [idx, idx] },
        nameMap: {
          colorscale_line_index:       'colorscale',
          color_range_line_index:      'color_range',
          color_scale_type_line_index: 'color_scale_type',
        },
      }
    })
  }
})

registerLayerType("multi-line", multiLineLayerType)
