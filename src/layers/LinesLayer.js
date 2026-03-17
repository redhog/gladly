// Lines mode uses instanced rendering:
//   - Template: 2 vertices with a_endPoint in {0.0, 1.0}  (divisor=0 → per-vertex)
//   - Per-segment data (x0/x1, y0/y1, v0/v1, seg0/seg1, f0/f1) sampled from GPU textures
//     using a_pickId (= gl_InstanceID) + 0.0 or + 1.0 as the index.
//
// Segment boundary handling: when a_seg0 != a_seg1, collapse both template vertices to
// (a_x0, a_y0) producing a zero-length degenerate line that the rasterizer discards.

import { ScatterLayerTypeBase } from "./ScatterShared.js"
import { Data } from "../data/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"
import { EXPRESSION_REF_OPT, resolveQuantityKind, resolveExprToColumn } from "../compute/ComputationRegistry.js"

function makeLinesVert(hasFilter, hasSegIds, hasV, hasV2, hasZ) {
  return `#version 300 es
  precision mediump float;
  in float a_endPoint;
  in float a_x0;
  in float a_y0;
  ${hasZ ? 'in float a_z0;\n  in float a_z1;' : ''}
  in float a_x1;
  in float a_y1;
  ${hasV  ? 'in float a_v0;\n  in float a_v1;'   : ''}
  ${hasV2 ? 'in float a_v20;\n  in float a_v21;' : ''}
  ${hasSegIds ? 'in float a_seg0;\n  in float a_seg1;' : ''}
  ${hasFilter ? 'in float a_f0;\n  in float a_f1;' : ''}
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  out float v_color_start;
  out float v_color_end;
  out float v_color2_start;
  out float v_color2_end;
  out float v_t;
  void main() {
    float same_seg = ${hasSegIds ? 'abs(a_seg0 - a_seg1) < 0.5 ? 1.0 : 0.0' : '1.0'};
    ${hasFilter ? 'if (!filter_(a_f0) || !filter_(a_f1)) same_seg = 0.0;' : ''}
    float t = same_seg * a_endPoint;
    float x = mix(a_x0, a_x1, t);
    float y = mix(a_y0, a_y1, t);
    ${hasZ ? 'float z = mix(a_z0, a_z1, t);\n    gl_Position = plot_pos_3d(vec3(x, y, z));'
           : 'gl_Position = plot_pos(vec2(x, y));'}
    v_color_start  = ${hasV  ? 'a_v0'  : '0.0'};
    v_color_end    = ${hasV  ? 'a_v1'  : '0.0'};
    v_color2_start = ${hasV2 ? 'a_v20' : '0.0'};
    v_color2_end   = ${hasV2 ? 'a_v21' : '0.0'};
    v_t = a_endPoint;
  }
`
}

function makeLinesFrag(hasFirst, hasSecond) {
  return `#version 300 es
  precision mediump float;
  uniform float u_lineColorMode;
  in float v_color_start;
  in float v_color_end;
  in float v_color2_start;
  in float v_color2_end;
  in float v_t;
  void main() {
    ${!hasFirst ? `
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);` : hasSecond ? `
    float value = u_lineColorMode > 0.5
      ? (v_t < 0.5 ? v_color_start : v_color_end)
      : mix(v_color_start, v_color_end, v_t);
    float value2 = u_lineColorMode > 0.5
      ? (v_t < 0.5 ? v_color2_start : v_color2_end)
      : mix(v_color2_start, v_color2_end, v_t);
    fragColor = map_color_2d_(vec2(value, value2));` : `
    float value = u_lineColorMode > 0.5
      ? (v_t < 0.5 ? v_color_start : v_color_end)
      : mix(v_color_start, v_color_end, v_t);
    fragColor = map_color_(value);`}
  }
`
}

class LinesLayerType extends ScatterLayerTypeBase {
  constructor() {
    super({ name: "lines", vert: makeLinesVert(false, false, false, false), frag: makeLinesFrag(false, false) })
  }

  schema(data) {
    const d = Data.wrap(data)
    return {
      type: "object",
      properties: {
        ...this._commonSchemaProperties(d),
        lineSegmentIdData: EXPRESSION_REF_OPT,
        lineColorMode: {
          type: "string",
          enum: ["gradient", "midpoint"],
          default: "gradient",
          description: "Color mode for lines: gradient interpolates vData linearly; midpoint uses each endpoint's color up to the segment center"
        },
        lineWidth: {
          type: "number",
          default: 1.0,
          minimum: 1,
          description: "Line width in pixels (note: browsers may clamp values above 1)"
        }
      },
      required: ["xData", "yData", "zData", "zAxis"]
    }
  }

  _createLayer(regl, parameters, data, plot) {
    const d = Data.wrap(data)
    const { lineSegmentIdData: lineSegmentIdDataRaw, lineColorMode = "gradient", lineWidth = 1.0 } = parameters
    const lineSegmentIdData = (lineSegmentIdDataRaw == null || lineSegmentIdDataRaw === "none") ? null : lineSegmentIdDataRaw
    const { xData, yData, zData: zDataOrig, vData: vDataOrig, vData2: vData2Orig, fData: fDataOrig } = parameters
    const zData  = (zDataOrig  == null || zDataOrig  === "none") ? null : zDataOrig
    const vData  = (vDataOrig  == null || vDataOrig  === "none") ? null : vDataOrig
    const vData2 = (vData2Orig == null || vData2Orig === "none") ? null : vData2Orig
    const fData  = (fDataOrig  == null || fDataOrig  === "none") ? null : fDataOrig

    const xQK = resolveQuantityKind(xData, d) ?? xData
    const yQK = resolveQuantityKind(yData, d) ?? yData
    const zQK  = zData  ? (resolveQuantityKind(zData,  d) ?? zData)  : null
    const vQK  = vData  ? (resolveQuantityKind(vData,  d) ?? vData)  : null
    const vQK2 = vData2 ? (resolveQuantityKind(vData2, d) ?? vData2) : null

    const colX   = resolveExprToColumn(xData, d, regl, plot)
    const colY   = resolveExprToColumn(yData, d, regl, plot)
    const colZ   = zData  ? resolveExprToColumn(zData,  d, regl, plot) : null
    const colV   = vData  ? resolveExprToColumn(vData,  d, regl, plot) : null
    const colV2  = vData2 ? resolveExprToColumn(vData2, d, regl, plot) : null
    const colF   = fData  ? resolveExprToColumn(fData,  d, regl, plot) : null
    const colSeg = lineSegmentIdData ? resolveExprToColumn(lineSegmentIdData, d, regl, plot) : null

    if (!colX) throw new Error(`Data column '${xData}' not found`)
    if (!colY) throw new Error(`Data column '${yData}' not found`)

    const N = colX.length
    const domains = this._buildDomains(d, xData, yData, zData, vData, vData2, xQK, yQK, zQK, vQK, vQK2)

    // For vData: if a string column, offset-sample start/end; if a computed expression,
    // pass through as-is (both endpoints get the same value, matching old behaviour).
    const vAttr0  = vData  ? (colV  ? colV.withOffset('0.0')  : vData)  : null
    const vAttr1  = vData  ? (colV  ? colV.withOffset('1.0')  : vData)  : null
    const vAttr20 = vData2 ? (colV2 ? colV2.withOffset('0.0') : vData2) : null
    const vAttr21 = vData2 ? (colV2 ? colV2.withOffset('1.0') : vData2) : null

    return [{
      attributes: {
        a_endPoint: new Float32Array([0.0, 1.0]),
        a_x0: colX.withOffset('0.0'),
        a_x1: colX.withOffset('1.0'),
        a_y0: colY.withOffset('0.0'),
        a_y1: colY.withOffset('1.0'),
        ...(colZ   ? { a_z0: colZ.withOffset('0.0'),   a_z1: colZ.withOffset('1.0')   } : {}),
        ...(vAttr0  !== null ? { a_v0:  vAttr0,  a_v1:  vAttr1  } : {}),
        ...(vAttr20 !== null ? { a_v20: vAttr20, a_v21: vAttr21 } : {}),
        ...(colSeg ? { a_seg0: colSeg.withOffset('0.0'), a_seg1: colSeg.withOffset('1.0') } : {}),
        ...(fData  ? { a_f0:  colF.withOffset('0.0'),  a_f1:  colF.withOffset('1.0')  } : {}),
      },
      uniforms: {
        u_lineColorMode: lineColorMode === "midpoint" ? 1.0 : 0.0,
      },
      domains,
      primitive: "lines",
      lineWidth,
      vertexCount: 2,
      instanceCount: N - 1,
    }]
  }

  createDrawCommand(regl, layer, plot) {
    const hasFilter  = Object.keys(layer.filterAxes).length > 0
    const hasFirst   = '' in layer.colorAxes
    const hasSecond  = '2' in layer.colorAxes
    const hasSegIds  = 'a_seg0' in layer.attributes
    const hasV       = 'a_v0'   in layer.attributes
    const hasV2      = 'a_v20'  in layer.attributes
    const hasZ       = 'a_z0'   in layer.attributes
    this.vert = makeLinesVert(hasFilter, hasSegIds, hasV, hasV2, hasZ)
    this.frag = makeLinesFrag(hasFirst, hasSecond)
    return super.createDrawCommand(regl, layer, plot)
  }
}

export const linesLayerType = new LinesLayerType()
registerLayerType("lines", linesLayerType)
