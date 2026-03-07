import { LayerType } from "../../src/core/LayerType.js"
import { AXES } from "../../src/axes/AxisRegistry.js"
import { registerLayerType } from "../../src/core/LayerTypeRegistry.js"
import { Data } from "../../src/core/Data.js"
import { ArrayColumn } from "../../src/compute/ComputationRegistry.js"

// Per-vertex quad corner coordinates for two CCW triangles: BL-BR-TR, BL-TR-TL
const QUAD_CX = new Float32Array([0, 1, 1, 0, 1, 0])
const QUAD_CY = new Float32Array([0, 0, 1, 0, 1, 1])

function columnDomain(col, d, colName) {
  if (col.domain) return col.domain
  const fromData = d.getDomain(colName)
  if (fromData) return fromData
  if (col instanceof ArrayColumn) {
    const arr = col.array
    let min = arr[0], max = arr[0]
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i]
      if (arr[i] > max) max = arr[i]
    }
    return [min, max]
  }
  return null
}

export const rectLayerType = new LayerType({
  name: "rects",
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left",

  getAxisConfig: function(params, data) {
    const d = Data.wrap(data)
    return {
      xAxis: params.xAxis,
      xAxisQuantityKind: d.getQuantityKind(params.xData) ?? params.xData,
      yAxis: params.yAxis,
      yAxisQuantityKind: d.getQuantityKind(params.yTopData) ?? params.yTopData,
      colorAxisQuantityKinds: { '': d.getQuantityKind(params.vData) ?? params.vData },
    }
  },

  // xPrev and xNext are computed in the vertex shader by sampling u_col_x at
  // a_pickId-1 and a_pickId+1 (with mirrored boundary conditions), so they
  // don't appear as attributes.  u_col_x is declared automatically by
  // createDrawCommand because 'x' is a ColumnData attribute.
  vert: `#version 300 es
    precision mediump float;
    in float cx;
    in float cy;
    in float x;
    in float top;
    in float bot;
    in float color_data;
    uniform float uE;
    uniform float u_n;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    out float value;

    void main() {
      float xPrev = a_pickId > 0.5
        ? sampleColumn(u_col_x, a_pickId - 1.0)
        : (u_n > 1.0 ? 2.0 * x - sampleColumn(u_col_x, 1.0) : x);
      float xNext = a_pickId < u_n - 1.5
        ? sampleColumn(u_col_x, a_pickId + 1.0)
        : (u_n > 1.0 ? 2.0 * x - sampleColumn(u_col_x, u_n - 2.0) : x);

      float halfLeft  = (x - xPrev) / 2.0;
      float halfRight = (xNext - x) / 2.0;

      // Cap: if one side exceeds e, use the other side's value (simultaneous, using originals).
      float hl = halfLeft  > uE ? halfRight : halfLeft;
      float hr = halfRight > uE ? halfLeft  : halfRight;

      float xPos = cx > 0.5 ? x + hr : x - hl;
      float yPos = cy > 0.5 ? top : bot;

      gl_Position = plot_pos(vec2(xPos, yPos));
      value = color_data;
    }
  `,

  frag: `#version 300 es
    precision mediump float;
    in float value;

    void main() {
      fragColor = map_color_(value);
    }
  `,

  schema: (data) => {
    const dataProperties = Data.wrap(data).columns()
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        xData:       { type: "string", enum: dataProperties, description: "Data key for x positions (rect centers)" },
        yTopData:    { type: "string", enum: dataProperties, description: "Data key for top y values" },
        yBottomData: { type: "string", enum: dataProperties, description: "Data key for bottom y values" },
        vData:       { type: "string", enum: dataProperties, description: "Data key for color values; also used as the color axis quantity kind" },
        e:           { type: "number", description: "Max half-width cap. If half-distance to a neighbor exceeds this, the opposite half-width is used instead." },
        xAxis: { type: "string", enum: AXES.filter(a => a.includes("x")), default: "xaxis_bottom" },
        yAxis: { type: "string", enum: AXES.filter(a => a.includes("y")), default: "yaxis_left" },
      },
      required: ["xData", "yTopData", "yBottomData", "vData"],
    }
  },

  createLayer: function(params, data) {
    const d = Data.wrap(data)
    const { xData, yTopData, yBottomData, vData, e = Infinity } = params

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yTopData) ?? yTopData
    const vQK = d.getQuantityKind(vData) ?? vData

    const xCol   = d.getData(xData)
    const topCol = d.getData(yTopData)
    const botCol = d.getData(yBottomData)
    const vCol   = d.getData(vData)

    if (!xCol)   throw new Error(`Data column '${xData}' not found`)
    if (!topCol) throw new Error(`Data column '${yTopData}' not found`)
    if (!botCol) throw new Error(`Data column '${yBottomData}' not found`)
    if (!vCol)   throw new Error(`Data column '${vData}' not found`)

    const n = xCol.length

    const xDomain   = columnDomain(xCol,   d, xData)
    const topDomain = columnDomain(topCol,  d, yTopData)
    const botDomain = columnDomain(botCol,  d, yBottomData)
    const vDomain   = columnDomain(vCol,    d, vData)

    const domains = {}
    if (xDomain) domains[xQK] = xDomain
    if (topDomain && botDomain) domains[yQK] = [Math.min(topDomain[0], botDomain[0]), Math.max(topDomain[1], botDomain[1])]
    if (vDomain) domains[vQK] = vDomain

    return [{
      attributes: {
        cx: QUAD_CX,       // per-vertex Float32Array (divisor 0)
        cy: QUAD_CY,       // per-vertex Float32Array (divisor 0)
        x:          xCol,  // ColumnData → GLSL sampler, sampled at a_pickId
        top:        topCol,
        bot:        botCol,
        color_data: vCol,
      },
      uniforms: { uE: e, u_n: n },
      domains,
      primitive: "triangles",
      vertexCount: 6,
      instanceCount: n,
    }]
  },
})

registerLayerType("rects", rectLayerType)
