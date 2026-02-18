import { LayerType } from "./LayerType.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

// Four vertices for a triangle-strip quad covering the entire clip space.
const quadCx = new Float32Array([-1, 1, -1, 1])
const quadCy = new Float32Array([-1, -1, 1, 1])

export const colorbarLayerType = new LayerType({
  name: "colorbar",
  primitive: "triangle strip",

  getAxisConfig: function(parameters) {
    const { colorAxis, orientation = "horizontal" } = parameters
    return {
      xAxis: orientation === "horizontal" ? "xaxis_bottom" : null,
      xAxisQuantityKind: orientation === "horizontal" ? colorAxis : undefined,
      yAxis: orientation === "vertical" ? "yaxis_left" : null,
      yAxisQuantityKind: orientation === "vertical" ? colorAxis : undefined,
      colorAxisQuantityKinds: [colorAxis],
    }
  },

  vert: `
    precision mediump float;
    attribute float cx;
    attribute float cy;
    uniform int horizontal;
    varying float tval;
    void main() {
      gl_Position = vec4(cx, cy, 0.0, 1.0);
      tval = horizontal == 1 ? (cx + 1.0) / 2.0 : (cy + 1.0) / 2.0;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    varying float tval;
    void main() {
      float r0 = color_scale_type > 0.5 ? log(color_range.x) : color_range.x;
      float r1 = color_scale_type > 0.5 ? log(color_range.y) : color_range.y;
      float v  = r0 + tval * (r1 - r0);
      gl_FragColor = map_color(colorscale, vec2(r0, r1), v);
    }
  `,

  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      colorAxis: { type: "string", description: "Quantity kind of the color axis to display" },
      orientation: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }
    },
    required: ["colorAxis"]
  }),

  createLayer: function(parameters) {
    const { colorAxis, orientation = "horizontal" } = parameters
    return {
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: { horizontal: orientation === "horizontal" ? 1 : 0 },
      vertexCount: 4,
      nameMap: {
        [`colorscale_${colorAxis}`]: 'colorscale',
        [`color_range_${colorAxis}`]: 'color_range',
        [`color_scale_type_${colorAxis}`]: 'color_scale_type',
      },
    }
  }
})

registerLayerType("colorbar", colorbarLayerType)
