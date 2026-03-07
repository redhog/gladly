import { LayerType } from "../core/LayerType.js"
import { Data } from "../core/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"
import { AXES } from "../axes/AxisRegistry.js"

// Generic instanced bar layer. Renders `instanceCount` bars using live texture refs
// for bin center x positions and bar heights (counts).
//
// Each bar is a quad drawn as a triangle strip (4 vertices).
// Per-instance: x_center (bin centre, from texture) and a_pickId (bin index, divisor 1).
// Per-vertex:   a_corner ∈ {0,1,2,3} — selects which corner of the rectangle.
//   corner 0: bottom-left   corner 1: bottom-right
//   corner 2: top-left      corner 3: top-right

const BARS_VERT = `#version 300 es
  precision mediump float;

  in float a_corner;
  in float x_center;
  in float count;

  uniform vec2  xDomain;
  uniform vec2  yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  uniform float u_binHalfWidth;

  void main() {
    float side = mod(a_corner, 2.0);       // 0 = left, 1 = right
    float top  = floor(a_corner / 2.0);    // 0 = bottom, 1 = top

    float bx = x_center + (side * 2.0 - 1.0) * u_binHalfWidth;
    float by = top * count;

    gl_Position = plot_pos(vec2(bx, by));
  }
`

const BARS_FRAG = `#version 300 es
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    fragColor = gladly_apply_color(u_color);
  }
`

class BarsLayerType extends LayerType {
  constructor() {
    super({ name: "bars", vert: BARS_VERT, frag: BARS_FRAG })
  }

  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
    }
  }

  schema(data) {
    const cols = Data.wrap(data).columns()
    return {
      type: "object",
      properties: {
        xData: {
          type: "string",
          enum: cols,
          description: "Column name for bin center x positions"
        },
        yData: {
          type: "string",
          enum: cols,
          description: "Column name for bar heights (counts)"
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
      required: ["xData", "yData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const {
      xData,
      yData,
      color = [0.2, 0.5, 0.8, 1.0],
    } = parameters

    const xRef = d.getData(xData)
    const yRef = d.getData(yData)
    if (!xRef) throw new Error(`BarsLayer: column '${xData}' not found`)
    if (!yRef) throw new Error(`BarsLayer: column '${yData}' not found`)

    const bins = xRef.length ?? 1

    const xDomain = d.getDomain(xData) ?? [0, 1]
    const yDomain = d.getDomain(yData) ?? [0, 1]
    const binHalfWidth = (xDomain[1] - xDomain[0]) / (2 * bins)

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData

    // Per-vertex corner indices 0–3 (triangle-strip quad)
    const a_corner = new Float32Array([0, 1, 2, 3])

    return [{
      attributes: {
        a_corner,    // per-vertex, no divisor
        x_center: xRef,  // live ref → resolved via _isLive path in resolveToGlslExpr
        count: yRef,     // live ref → resolved via _isLive path
      },
      uniforms: {
        u_binHalfWidth: binHalfWidth,
        u_color: color,
      },
      vertexCount: 4,
      instanceCount: bins,
      primitive: "triangle strip",
      domains: {
        [xQK]: xDomain,
        [yQK]: yDomain,
      },
    }]
  }
}

export const barsLayerType = new BarsLayerType()
registerLayerType("bars", barsLayerType)
