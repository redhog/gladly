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
    uniform int colorscale_%%color0%%;
    uniform vec2 color_range_%%color0%%;
    varying float tval;
    void main() {
      float value = color_range_%%color0%%.x + tval * (color_range_%%color0%%.y - color_range_%%color0%%.x);
      gl_FragColor = map_color(colorscale_%%color0%%, color_range_%%color0%%, value);
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
    const { orientation = "horizontal" } = parameters
    return {
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: { horizontal: orientation === "horizontal" ? 1 : 0 },
      vertexCount: 4,
    }
  }
})

registerLayerType("colorbar", colorbarLayerType)
