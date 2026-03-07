import { LayerType } from "../../src/core/LayerType.js"
import { registerLayerType } from "../../src/core/LayerTypeRegistry.js"
import { AXES } from "../../src/axes/AxisRegistry.js"
import { Data } from "../../src/core/Data.js"

function makeMultiLineVert(hasFilter) {
  return `#version 300 es
    precision mediump float;
    in float a_endPoint;
    in float x;
    in float y;
    ${hasFilter ? 'in float filter0;\n    in float filter1;' : ''}
    uniform float u_line_index;
    ${hasFilter ? 'uniform float u_cutoff;' : ''}
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    out float vLineIndex;
    out float vBadSegment;
    void main() {
      ${hasFilter
        ? 'float isBad = (filter0 > u_cutoff || filter1 > u_cutoff) ? 1.0 : 0.0;'
        : 'float isBad = 0.0;'}
      gl_Position = plot_pos(vec2(x, y));
      vLineIndex = u_line_index;
      vBadSegment = isBad;
    }
  `
}

export const multiLineLayerType = new LayerType({
  name: "multi-line",

  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left",
  colorAxisQuantityKinds: { '': "line_index" },

  getAxisConfig: function(parameters, data) {
    const d = Data.wrap(data)
    const { xData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
    }
  },

  vert: makeMultiLineVert(false),

  frag: `#version 300 es
    precision mediump float;
    uniform vec4 bad_color;
    in float vLineIndex;
    in float vBadSegment;
    void main() {
      if (vBadSegment > 0.5) {
        fragColor = gladly_apply_color(bad_color);
      } else {
        fragColor = map_color_(vLineIndex);
      }
    }
  `,

  schema: (data) => {
    const dataProperties = Data.wrap(data).columns()
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
    const d = Data.wrap(data)
    const {
      xData,
      filterData,
      cutoff = 0,
      badColor = [0.5, 0.5, 0.5, 1.0],
    } = parameters

    const colX = d.getData(xData)
    if (!colX) throw new Error(`Data column '${xData}' not found`)
    const colFilter = filterData ? d.getData(filterData) : null
    const N = colX.length
    const nSegs = N - 1

    const yColumns = d.columns().filter(k => k !== xData && k !== filterData)

    return yColumns.map((colName, idx) => {
      const colY = d.getData(colName)

      return {
        attributes: {
          a_endPoint: new Float32Array([0.0, 1.0]),
          x: colX.withOffset('a_endPoint'),
          y: colY.withOffset('a_endPoint'),
          ...(colFilter ? {
            filter0: colFilter.withOffset('0.0'),
            filter1: colFilter.withOffset('1.0'),
          } : {}),
        },
        uniforms: {
          bad_color: badColor,
          u_line_index: yColumns.length > 1 ? idx / (yColumns.length - 1) : 0.5,
          ...(colFilter ? { u_cutoff: cutoff } : {}),
        },
        domains: { line_index: [idx, idx] },
        primitive: "lines",
        lineWidth: 2,
        vertexCount: 2,
        instanceCount: nSegs,
      }
    })
  },

  createDrawCommand: function(regl, layer, plot) {
    const hasFilter = 'filter0' in layer.attributes
    this.vert = makeMultiLineVert(hasFilter)
    return LayerType.prototype.createDrawCommand.call(this, regl, layer, plot)
  },
})

registerLayerType("multi-line", multiLineLayerType)
