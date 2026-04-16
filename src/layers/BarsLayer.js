import { LayerType } from "../core/LayerType.js"
import { Data } from "../data/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"
import { AXES } from "../axes/AxisRegistry.js"
import { parseCssColor } from "../core/colorUtils.js"

// Generic instanced bar layer. Renders `instanceCount` bars using live texture refs
// for bin center positions and bar lengths (counts).
//
// Each bar is a quad drawn as a triangle strip (4 vertices).
// Per-instance: x_center (bin centre, from texture) and a_pickId (bin index, divisor 1).
// Per-vertex:   a_corner ∈ {0,1,2,3} — selects which corner of the rectangle.
//   corner 0: bottom-left   corner 1: bottom-right
//   corner 2: top-left      corner 3: top-right
//
// orientation "vertical"   — bins on x-axis, bars extend upward (default)
// orientation "horizontal" — bins on y-axis, bars extend rightward

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
  uniform float u_horizontal;

  void main() {
    float side = mod(a_corner, 2.0);       // 0 = left, 1 = right
    float vert = floor(a_corner / 2.0);    // 0 = bottom, 1 = top

    float bx = mix(x_center + (side * 2.0 - 1.0) * u_binHalfWidth, side * count, u_horizontal);
    float by = mix(vert * count, x_center + (vert * 2.0 - 1.0) * u_binHalfWidth, u_horizontal);

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
    const { xData, yData, xAxis = "xaxis_bottom", yAxis = "yaxis_left", orientation = "vertical" } = parameters
    if (orientation === "horizontal") {
      return {
        xAxis,
        xAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
        yAxis,
        yAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      }
    }
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
          type: "string",
          format: "color",
          "x-format": "color",
          default: "#3380cc",
          description: "Bar colour as a CSS hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa)"
        },
        orientation: {
          type: "string",
          enum: ["vertical", "horizontal"],
          default: "vertical",
          description: "vertical: bins on x-axis, bars extend up; horizontal: bins on y-axis, bars extend right"
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

  _createLayer(regl, parameters, data, plot) {
    const d = Data.wrap(data)
    const {
      xData,
      yData,
      color = "#3380cc",
      orientation = "vertical",
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
        u_color: parseCssColor(color),
        u_horizontal: orientation === "horizontal" ? 1.0 : 0.0,
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
export { BarsLayerType }
