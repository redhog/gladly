import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { registerLayerType } from "./LayerTypeRegistry.js"
import { Data } from "./Data.js"

const POINTS_VERT = `
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
`

const POINTS_FRAG = `
  precision mediump float;
  uniform int colorscale;
  uniform vec2 color_range;
  uniform float color_scale_type;
  uniform float alphaBlend;
  varying float value;
  void main() {
    gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type, alphaBlend);
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

const LINES_VERT = `
  precision mediump float;
  attribute float a_endPoint;
  attribute float a_x0, a_y0;
  attribute float a_x1, a_y1;
  attribute float a_v0, a_v1;
  attribute float a_seg0, a_seg1;
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  varying float v_color_start;
  varying float v_color_end;
  varying float v_t;
  void main() {
    float same_seg = abs(a_seg0 - a_seg1) < 0.5 ? 1.0 : 0.0;
    float t = same_seg * a_endPoint;
    float x = mix(a_x0, a_x1, t);
    float y = mix(a_y0, a_y1, t);
    float nx = normalize_axis(x, xDomain, xScaleType);
    float ny = normalize_axis(y, yDomain, yScaleType);
    gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0, 1);
    v_color_start = a_v0;
    v_color_end   = a_v1;
    v_t = a_endPoint;
  }
`

const LINES_FRAG = `
  precision mediump float;
  uniform int colorscale;
  uniform vec2 color_range;
  uniform float color_scale_type;
  uniform float alphaBlend;
  uniform float u_lineColorMode;
  varying float v_color_start;
  varying float v_color_end;
  varying float v_t;
  void main() {
    float value = u_lineColorMode > 0.5
      ? (v_t < 0.5 ? v_color_start : v_color_end)
      : mix(v_color_start, v_color_end, v_t);
    gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type, alphaBlend);
  }
`

class ScatterLayerType extends LayerType {
  constructor() {
    super({ name: "scatter", vert: POINTS_VERT, frag: POINTS_FRAG })
  }

  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, xAxis, yAxis } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
      colorAxisQuantityKinds: [d.getQuantityKind(vData) ?? vData],
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
      xData, yData, vData,
      alphaBlend = false,
      mode = "points",
      lineSegmentIdData,
      lineColorMode = "gradient",
      lineWidth = 1.0,
    } = parameters

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData
    const vQK = d.getQuantityKind(vData) ?? vData

    const srcX = d.getData(xData)
    const srcY = d.getData(yData)
    const srcV = d.getData(vData)

    if (!srcX) throw new Error(`Data column '${xData}' not found`)
    if (!srcY) throw new Error(`Data column '${yData}' not found`)
    if (!srcV) throw new Error(`Data column '${vData}' not found`)

    const domains = {}
    const xDomain = d.getDomain(xData)
    const yDomain = d.getDomain(yData)
    const vDomain = d.getDomain(vData)
    if (xDomain) domains[xQK] = xDomain
    if (yDomain) domains[yQK] = yDomain
    if (vDomain) domains[vQK] = vDomain

    const blendConfig = alphaBlend ? {
      enable: true,
      func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 },
    } : null

    if (mode === "lines") {
      const N = srcX.length
      const segIds = lineSegmentIdData ? d.getData(lineSegmentIdData) : null
      // Zero-init array used when no segment IDs: abs(0-0) < 0.5 → always same segment
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
          a_v0: srcV.subarray(0, N - 1),
          a_v1: srcV.subarray(1, N),
          a_seg0: seg0,
          a_seg1: seg1,
        },
        attributeDivisors: {
          a_x0: 1, a_x1: 1,
          a_y0: 1, a_y1: 1,
          a_v0: 1, a_v1: 1,
          a_seg0: 1, a_seg1: 1,
        },
        uniforms: {
          alphaBlend: alphaBlend ? 1.0 : 0.0,
          u_lineColorMode: lineColorMode === "midpoint" ? 1.0 : 0.0,
        },
        nameMap: {
          [`colorscale_${vQK}`]: 'colorscale',
          [`color_range_${vQK}`]: 'color_range',
          [`color_scale_type_${vQK}`]: 'color_scale_type',
        },
        domains,
        primitive: "lines",
        lineWidth,
        vertexCount: 2,
        instanceCount: N - 1,
        blend: blendConfig,
      }]
    }

    // Points mode — existing behaviour
    return [{
      attributes: { x: srcX, y: srcY, [vQK]: srcV },
      uniforms: { alphaBlend: alphaBlend ? 1.0 : 0.0 },
      domains,
      nameMap: {
        [vQK]: 'color_data',
        [`colorscale_${vQK}`]: 'colorscale',
        [`color_range_${vQK}`]: 'color_range',
        [`color_scale_type_${vQK}`]: 'color_scale_type',
      },
      blend: blendConfig,
    }]
  }

  // Swap vert/frag to the lines variants before letting the parent build the draw command,
  // then restore. JS is single-threaded so the temporary swap is safe.
  createDrawCommand(regl, layer) {
    if (layer.primitive === "lines") {
      this.vert = LINES_VERT
      this.frag = LINES_FRAG
    } else {
      this.vert = POINTS_VERT
      this.frag = POINTS_FRAG
    }
    return super.createDrawCommand(regl, layer)
  }
}

export const scatterLayerType = new ScatterLayerType()
registerLayerType("scatter", scatterLayerType)
