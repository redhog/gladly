// Lines mode uses instanced rendering:
//   - Template: 2 vertices with a_endPoint in {0.0, 1.0}  (divisor=0 → interpolates)
//   - Per-segment: a_x0/x1, a_y0/y1, a_v0/v1, a_seg0/seg1 (divisor=1 → constant per instance)
//
// Because a_v0 and a_v1 are instanced, they are the same at both template vertices for a given
// segment, so varyings set from them are constant across the line (no GPU interpolation).
// Only v_t (from a_endPoint) interpolates, giving the position along the segment.
//
// Segment boundary handling: when a_seg0 != a_seg1, collapse both template vertices to
// (a_x0, a_y0) producing a zero-length degenerate line that the rasterizer discards.

import { ScatterLayerTypeBase } from "./ScatterShared.js"
import { Data } from "../core/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

function makeLinesVert(hasFilter) {
  return `
  precision mediump float;
  attribute float a_endPoint;
  attribute float a_x0, a_y0;
  attribute float a_x1, a_y1;
  attribute float a_v0, a_v1;
  attribute float a_v20, a_v21;
  attribute float a_seg0, a_seg1;
  ${hasFilter ? 'attribute float a_f0, a_f1;\n  uniform vec4 filter_range;' : ''}
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  varying float v_color_start;
  varying float v_color_end;
  varying float v_color2_start;
  varying float v_color2_end;
  varying float v_t;
  void main() {
    float same_seg = abs(a_seg0 - a_seg1) < 0.5 ? 1.0 : 0.0;
    ${hasFilter ? 'if (!filter_(a_f0) || !filter_(a_f1)) same_seg = 0.0;' : ''}
    float t = same_seg * a_endPoint;
    float x = mix(a_x0, a_x1, t);
    float y = mix(a_y0, a_y1, t);
    gl_Position = plot_pos(vec2(x, y));
    v_color_start  = a_v0;
    v_color_end    = a_v1;
    v_color2_start = a_v20;
    v_color2_end   = a_v21;
    v_t = a_endPoint;
  }
`
}

const LINES_FRAG = `
  precision mediump float;

  uniform int colorscale;
  uniform vec2 color_range;
  uniform float color_scale_type;

  uniform int colorscale2;
  uniform vec2 color_range2;
  uniform float color_scale_type2;

  uniform float u_lineColorMode;
  uniform float u_useSecondColor;

  varying float v_color_start;
  varying float v_color_end;
  varying float v_color2_start;
  varying float v_color2_end;
  varying float v_t;

  void main() {
    float value = u_lineColorMode > 0.5
      ? (v_t < 0.5 ? v_color_start : v_color_end)
      : mix(v_color_start, v_color_end, v_t);

    if (u_useSecondColor > 0.5) {
      float value2 = u_lineColorMode > 0.5
        ? (v_t < 0.5 ? v_color2_start : v_color2_end)
        : mix(v_color2_start, v_color2_end, v_t);

      gl_FragColor = map_color_s_2d(
        colorscale, color_range, value, color_scale_type,
        colorscale2, color_range2, value2, color_scale_type2
      );
    } else {
      gl_FragColor = map_color_(value);
    }
  }
`

class LinesLayerType extends ScatterLayerTypeBase {
  constructor() {
    super({ name: "lines", vert: makeLinesVert(false), frag: LINES_FRAG })
  }

  schema(data) {
    const dataProperties = Data.wrap(data).columns()
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        ...this._commonSchemaProperties(dataProperties),
        lineSegmentIdData: {
          type: "string",
          enum: dataProperties,
          description: "Column for segment IDs; only consecutive points sharing the same ID are connected"
        },
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
      required: ["xData", "yData", "vData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const { lineSegmentIdData, lineColorMode = "gradient", lineWidth = 1.0 } = parameters
    const { xData, yData, vData, vData2, fData, xQK, yQK, vQK, vQK2, fQK, srcX, srcY, srcV, srcV2, srcF } =
      this._resolveColorData(parameters, d)

    const useSecond = vData2 ? 1.0 : 0.0
    const domains = this._buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2)

    const N = srcX.length
    const segIds = lineSegmentIdData ? d.getData(lineSegmentIdData) : null
    const zeroSegs = new Float32Array(N - 1)
    const seg0 = segIds ? segIds.subarray(0, N - 1) : zeroSegs
    const seg1 = segIds ? segIds.subarray(1, N) : zeroSegs

    return [{
      attributes: {
        a_endPoint: new Float32Array([0.0, 1.0]),
        a_x0: srcX.subarray(0, N - 1),
        a_x1: srcX.subarray(1, N),
        a_y0: srcY.subarray(0, N - 1),
        a_y1: srcY.subarray(1, N),
        a_v0: vData ? srcV.subarray(0, N - 1) : new Float32Array(N - 1),
        a_v1: vData ? srcV.subarray(1, N) : new Float32Array(N - 1),
        a_v20: vData2 ? srcV2.subarray(0, N - 1) : new Float32Array(N - 1),
        a_v21: vData2 ? srcV2.subarray(1, N) : new Float32Array(N - 1),
        a_seg0: seg0,
        a_seg1: seg1,
        ...(fData ? {
          a_f0: srcF.subarray(0, N - 1),
          a_f1: srcF.subarray(1, N),
        } : {}),
      },
      attributeDivisors: {
        a_x0: 1, a_x1: 1,
        a_y0: 1, a_y1: 1,
        a_v0: 1, a_v1: 1,
        a_v20: 1, a_v21: 1,
        a_seg0: 1, a_seg1: 1,
        ...(fData ? { a_f0: 1, a_f1: 1 } : {}),
      },
      uniforms: {
        u_lineColorMode: lineColorMode === "midpoint" ? 1.0 : 0.0,
        u_useSecondColor: useSecond,
        ...(vData ? {} : { colorscale: 0, color_range: [0, 1], color_scale_type: 0.0 }),
        ...(vData2 ? {} : { colorscale2: 0, color_range2: [0, 1], color_scale_type2: 0.0 })
      },
      domains,
      primitive: "lines",
      lineWidth,
      vertexCount: 2,
      instanceCount: N - 1,
    }]
  }

  createDrawCommand(regl, layer) {
    const hasFilter = Object.keys(layer.filterAxes).length > 0
    this.vert = makeLinesVert(hasFilter)
    return super.createDrawCommand(regl, layer)
  }
}

export const linesLayerType = new LinesLayerType()
registerLayerType("lines", linesLayerType)
