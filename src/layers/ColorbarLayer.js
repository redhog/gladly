import { LayerType } from "../core/LayerType.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

const quadCx = new Float32Array([-1, 1, -1, 1])
const quadCy = new Float32Array([-1, -1, 1, 1])

const COLORBAR_VERT = `#version 300 es
    precision mediump float;
    in float cx;
    in float cy;
    uniform int horizontal;
    out float tval;
    void main() {
      gl_Position = vec4(cx, cy, 0.0, 1.0);
      tval = horizontal == 1 ? (cx + 1.0) / 2.0 : (cy + 1.0) / 2.0;
    }
  `

const COLORBAR_FRAG = `#version 300 es
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    in float tval;
    void main() {
      float r0 = color_scale_type > 0.5 ? log(color_range.x) : color_range.x;
      float r1 = color_scale_type > 0.5 ? log(color_range.y) : color_range.y;
      float v  = r0 + tval * (r1 - r0);
      fragColor = gladly_apply_color(map_color(colorscale, vec2(r0, r1), v));
    }
  `

class ColorbarLayerType extends LayerType {
  constructor() {
    super({ name: "colorbar", suppressWarnings: true, vert: COLORBAR_VERT, frag: COLORBAR_FRAG })
  }

  _getAxisConfig(parameters) {
    const { colorAxis, orientation = "horizontal" } = parameters
    return {
      xAxis: orientation === "horizontal" ? "xaxis_bottom" : null,
      xAxisQuantityKind: orientation === "horizontal" ? colorAxis : undefined,
      yAxis: orientation === "vertical" ? "yaxis_left" : null,
      yAxisQuantityKind: orientation === "vertical" ? colorAxis : undefined,
      colorAxisQuantityKinds: { '': colorAxis },
    }
  }

  schema() {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        colorAxis: { type: "string", description: "Quantity kind of the color axis to display" },
        orientation: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }
      },
      required: ["colorAxis"]
    }
  }

  _createLayer(regl, parameters) {
    const { orientation = "horizontal" } = parameters
    return [{
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: { horizontal: orientation === "horizontal" ? 1 : 0 },
      primitive: "triangle strip",
      vertexCount: 4,
    }]
  }
}

export const colorbarLayerType = new ColorbarLayerType()
registerLayerType("colorbar", colorbarLayerType)
export { ColorbarLayerType }
