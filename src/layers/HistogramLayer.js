import { LayerType } from "../core/LayerType.js"
import { Data } from "../core/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"
import { AXES } from "../axes/AxisRegistry.js"

// Ensure the 'histogram' texture computation is registered (side-effect import).
import "../compute/hist.js"

// Each bar is a quad drawn as a triangle strip (4 vertices).
// Per-instance: x_center (bin centre in data space), a_pickId (bin index).
// Per-vertex:   a_corner ∈ {0,1,2,3} — selects which corner of the rectangle.
//   corner 0: bottom-left   corner 1: bottom-right
//   corner 2: top-left      corner 3: top-right
// The `count` attribute is resolved via the 'histogram' texture computation so
// its value equals the bin count sampled at a_pickId.

const HIST_VERT = `
  precision mediump float;

  attribute float a_corner;
  attribute float x_center;
  attribute float count;

  uniform vec2  xDomain;
  uniform vec2  yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  uniform float u_binHalfWidth;

  void main() {
    float side   = mod(a_corner, 2.0);        // 0 = left, 1 = right
    float top    = floor(a_corner / 2.0);     // 0 = bottom, 1 = top

    float bx = x_center + (side * 2.0 - 1.0) * u_binHalfWidth;
    float by = top * count;

    float nx = normalize_axis(bx, xDomain, xScaleType);
    float ny = normalize_axis(by, yDomain, yScaleType);
    gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
  }
`

const HIST_FRAG = `
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    gl_FragColor = gladly_apply_color(u_color);
  }
`

class HistogramLayerType extends LayerType {
  constructor() {
    super({ name: "histogram", vert: HIST_VERT, frag: HIST_FRAG })
  }

  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { vData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(vData) ?? vData,
      yAxis,
      yAxisQuantityKind: "count",
    }
  }

  schema(data) {
    const dataProperties = Data.wrap(data).columns()
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        vData: {
          type: "string",
          enum: dataProperties,
          description: "Data column to histogram"
        },
        bins: {
          type: "integer",
          description: "Number of bins (auto-selected by sqrt rule if omitted)"
        },
        color: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          default: [0.2, 0.5, 0.8, 1.0],
          description: "Bar colour as [R, G, B, A] in [0, 1]"
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
      required: ["vData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const {
      vData,
      bins: requestedBins = null,
      color = [0.2, 0.5, 0.8, 1.0],
    } = parameters

    const srcV = d.getData(vData)
    if (!srcV) throw new Error(`Data column '${vData}' not found`)
    const vQK = d.getQuantityKind(vData) ?? vData

    // --- Compute min/max for normalization ---
    let min = Infinity, max = -Infinity
    for (let i = 0; i < srcV.length; i++) {
      if (srcV[i] < min) min = srcV[i]
      if (srcV[i] > max) max = srcV[i]
    }
    const range = max - min || 1

    // --- Choose bin count ---
    const bins = requestedBins ?? Math.max(10, Math.min(200, Math.ceil(Math.sqrt(srcV.length))))
    const binWidth = range / bins

    // --- Normalize data to [0, 1] for the histogram computation ---
    const normalized = new Float32Array(srcV.length)
    for (let i = 0; i < srcV.length; i++) {
      normalized[i] = (srcV[i] - min) / range
    }

    // --- CPU histogram for domain (y-axis range) estimation ---
    const histCpu = new Float32Array(bins)
    for (let i = 0; i < srcV.length; i++) {
      const b = Math.min(Math.floor(normalized[i] * bins), bins - 1)
      histCpu[b] += 1
    }
    const maxCount = Math.max(...histCpu)

    // --- Per-instance: bin centre positions in data space ---
    const x_center = new Float32Array(bins)
    for (let i = 0; i < bins; i++) {
      x_center[i] = min + (i + 0.5) * binWidth
    }

    // --- Per-vertex: corner indices 0–3 (triangle-strip quad) ---
    const a_corner = new Float32Array([0, 1, 2, 3])

    return [{
      attributes: {
        a_corner,          // per-vertex (no divisor)
        x_center,          // per-instance (divisor 1)
        // GPU histogram via computed attribute; sampled at a_pickId (= bin index)
        count: { histogram: { input: normalized, bins } },
      },
      attributeDivisors: { x_center: 1 },
      uniforms: {
        u_binHalfWidth: binWidth / 2,
        u_color: color,
      },
      vertexCount: 4,
      instanceCount: bins,
      primitive: "triangle strip",
      domains: {
        [vQK]: [min, max],
        count:  [0, maxCount],
      },
    }]
  }
}

export const histogramLayerType = new HistogramLayerType()
registerLayerType("histogram", histogramLayerType)
