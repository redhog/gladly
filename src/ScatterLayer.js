import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { registerLayerType } from "./LayerTypeRegistry.js"
import { Data } from "./Data.js"

function makePointsVert(hasFilter) {
  return `
  precision mediump float;
  attribute float x;
  attribute float y;
  attribute float color_data;
  attribute float color_data2;
  ${hasFilter ? 'attribute float filter_data;\n  uniform vec4 filter_range;' : ''}
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  varying float value;
  varying float value2;
  void main() {
    ${hasFilter ? 'if (!filter_in_range(filter_range, filter_data)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }' : ''}
    float nx = normalize_axis(x, xDomain, xScaleType);
    float ny = normalize_axis(y, yDomain, yScaleType);
    gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
    gl_PointSize = 4.0;
    value = color_data;
    value2 = color_data2;
  }
`
}

const POINTS_FRAG = `
  precision mediump float;
  uniform int colorscale;
  uniform vec2 color_range;
  uniform float color_scale_type;

  uniform int colorscale2;
  uniform vec2 color_range2;
  uniform float color_scale_type2;

  uniform float alphaBlend;
  uniform float u_useSecondColor;

  varying float value;
  varying float value2;

  void main() {
    if (u_useSecondColor > 0.5) {
      gl_FragColor = map_color_s_2d(
        colorscale, color_range, value, color_scale_type,
        colorscale2, color_range2, value2, color_scale_type2
      );
      if (alphaBlend > 0.5) {
        gl_FragColor.a *= gl_FragColor.a;
      }
    } else {
      gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type, alphaBlend);
    }
  }
`

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
    ${hasFilter ? 'if (!filter_in_range(filter_range, a_f0) || !filter_in_range(filter_range, a_f1)) same_seg = 0.0;' : ''}
    float t = same_seg * a_endPoint;
    float x = mix(a_x0, a_x1, t);
    float y = mix(a_y0, a_y1, t);
    float nx = normalize_axis(x, xDomain, xScaleType);
    float ny = normalize_axis(y, yDomain, yScaleType);
    gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
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

  uniform float alphaBlend;
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

      if (alphaBlend > 0.5) {
        gl_FragColor.a *= gl_FragColor.a;
      }
    } else {
      gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type, alphaBlend);
    }
  }
`

class ScatterLayerType extends LayerType {
  constructor() {
    super({ name: "scatter", vert: makePointsVert(false), frag: POINTS_FRAG })
  }

  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, vData2, fData, xAxis, yAxis } = parameters
    const colorAxisQuantityKinds = [d.getQuantityKind(vData) ?? vData]
    if (vData2) {
      colorAxisQuantityKinds.push(d.getQuantityKind(vData2) ?? vData2)
    }
    const filterAxisQuantityKinds = fData ? [d.getQuantityKind(fData) ?? fData] : []
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
      colorAxisQuantityKinds,
      filterAxisQuantityKinds,
    }
  }

  schema(data) {
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
          enum: ["none"].concat(dataProperties),
          description: "Primary property name in data object for color values"
        },
        vData2: {
          type: "string",
          enum: ["none"].concat(dataProperties),
          description: "Optional secondary property name for 2D color mapping"
        },
        fData: {
          type: "string",
          enum: ["none"].concat(dataProperties),
          description: "Optional property name for filter axis values"
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
        },
        alphaBlend: {
          type: "boolean",
          default: false,
          description: "Map the normalized color value to alpha so low values fade to transparent"
        },
        mode: {
          type: "string",
          enum: ["points", "lines"],
          default: "points",
          description: "Render as individual points or connected lines"
        },
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
    const {
      xData, yData, vData: vDataOrig, vData2: vData2Orig, fData: fDataOrig,
      alphaBlend = false,
      mode = "points",
      lineSegmentIdData,
      lineColorMode = "gradient",
      lineWidth = 1.0,
    } = parameters

    const vData = vDataOrig == "none" ? null : vDataOrig
    const vData2 = vData2Orig == "none" ? null : vData2Orig
    const fData = fDataOrig == "none" ? null : fDataOrig

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData
    const vQK = vData ? (d.getQuantityKind(vData) ?? vData) : null
    const vQK2 = vData2 ? (d.getQuantityKind(vData2) ?? vData2) : null
    const fQK = fData ? (d.getQuantityKind(fData) ?? fData) : null

    const srcX = d.getData(xData)
    const srcY = d.getData(yData)
    const srcV = vData ? d.getData(vData) : null
    const srcV2 = vData2 ? d.getData(vData2) : null
    const srcF = fData ? d.getData(fData) : null

    if (!srcX) throw new Error(`Data column '${xData}' not found`)
    if (!srcY) throw new Error(`Data column '${yData}' not found`)
    if (vData && !srcV) throw new Error(`Data column '${vData}' not found`)
    if (vData2 && !srcV2) throw new Error(`Data column '${vData2}' not found`)
    if (fData && !srcF) throw new Error(`Data column '${fData}' not found`)

    const domains = {}

    const xDomain = d.getDomain(xData)
    if (xDomain) domains[xQK] = xDomain

    const yDomain = d.getDomain(yData)
    if (yDomain) domains[yQK] = yDomain

    if (vData) {
      const vDomain = d.getDomain(vData)
      if (vDomain) domains[vQK] = vDomain
    }

    if (vData2) {
      const vDomain2 = d.getDomain(vData2)
      if (vDomain2) domains[vQK2] = vDomain2
    }

    const blendConfig = alphaBlend ? {
      enable: true,
      func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 },
    } : null

    const useSecond = vData2 ? 1.0 : 0.0

    if (mode === "lines") {
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
          alphaBlend: alphaBlend ? 1.0 : 0.0,
          u_lineColorMode: lineColorMode === "midpoint" ? 1.0 : 0.0,
          u_useSecondColor: useSecond,
          ...(vData ? {} : {colorscale: 0, color_range: [0, 1], color_scale_type: 0.0}),
          ...(vData2 ? {} : {colorscale2: 0, color_range2: [0, 1], color_scale_type2: 0.0})
        },
        nameMap: {
          ...(vData ? {
            [`colorscale_${vQK}`]: 'colorscale',
            [`color_range_${vQK}`]: 'color_range',
            [`color_scale_type_${vQK}`]: 'color_scale_type',
          } : {}),
          ...(vData2 ? {
            [`colorscale_${vQK2}`]: 'colorscale2',
            [`color_range_${vQK2}`]: 'color_range2',
            [`color_scale_type_${vQK2}`]: 'color_scale_type2',
          } : {}),
          ...(fData ? { [`filter_range_${fQK}`]: 'filter_range' } : {}),
        },
        domains,
        primitive: "lines",
        lineWidth,
        vertexCount: 2,
        instanceCount: N - 1,
        blend: blendConfig,
      }]
    }

    return [{
      attributes: {
        x: srcX,
        y: srcY,
        color_data: vData ? srcV : new Float32Array(srcX.length),
        color_data2: vData2 ? srcV2 : new Float32Array(srcX.length),
        ...(fData ? { filter_data: srcF } : {}),
      },
      uniforms: {
        alphaBlend: alphaBlend ? 1.0 : 0.0,
        u_useSecondColor: useSecond,
        ...(vData ? {} : {colorscale: 0, color_range: [0, 1], color_scale_type: 0.0}),
        ...(vData2 ? {} : {colorscale2: 0, color_range2: [0, 1], color_scale_type2: 0.0})
      },
      domains,
      nameMap: {
        ...(vData ? {
          [`colorscale_${vQK}`]: 'colorscale',
          [`color_range_${vQK}`]: 'color_range',
          [`color_scale_type_${vQK}`]: 'color_scale_type',
        } : {}),
        ...(vData2 ? {
          [`colorscale_${vQK2}`]: 'colorscale2',
          [`color_range_${vQK2}`]: 'color_range2',
          [`color_scale_type_${vQK2}`]: 'color_scale_type2',
        } : {}),
        ...(fData ? { [`filter_range_${fQK}`]: 'filter_range' } : {}),
      },
      blend: blendConfig,
    }]
  }

  createDrawCommand(regl, layer) {
    const hasFilter = layer.filterAxes.length > 0
    if (layer.primitive === "lines") {
      this.vert = makeLinesVert(hasFilter)
      this.frag = LINES_FRAG
    } else {
      this.vert = makePointsVert(hasFilter)
      this.frag = POINTS_FRAG
    }
    return super.createDrawCommand(regl, layer)
  }
}

export const scatterLayerType = new ScatterLayerType()
registerLayerType("scatter", scatterLayerType)
