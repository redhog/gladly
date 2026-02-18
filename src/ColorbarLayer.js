import { LayerType } from "./LayerType.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

// Four vertices for a triangle-strip quad covering the entire clip space.
const quadCx = new Float32Array([-1, 1, -1, 1])
const quadCy = new Float32Array([-1, -1, 1, 1])

export const colorbarLayerType = new LayerType({
  name: "colorbar",
  axisQuantityKinds: { x: null, y: null },
  colorAxisQuantityKinds: { v: null },
  primitive: "triangle strip",

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
    uniform int colorscale_v;
    uniform vec2 color_range_v;
    varying float tval;
    void main() {
      float value = color_range_v.x + tval * (color_range_v.y - color_range_v.x);
      gl_FragColor = map_color(colorscale_v, color_range_v, value);
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

  getAxisQuantityKinds: function(parameters) {
    const { colorAxis, orientation = "horizontal" } = parameters
    // The axis that runs along the color range gets the colorAxis quantity kind.
    // The unused direction gets a placeholder unit ("meters") that is never registered
    // because that axis is set to null in createLayer.
    return {
      x: orientation === "horizontal" ? colorAxis : "meters",
      y: orientation === "vertical"   ? colorAxis : "meters"
    }
  },

  getColorAxisQuantityKinds: function(parameters) {
    return { v: parameters.colorAxis }
  },

  createLayer: function(parameters) {
    const { colorAxis, orientation = "horizontal" } = parameters
    return {
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: { horizontal: orientation === "horizontal" ? 1 : 0 },
      xAxis: orientation === "horizontal" ? "xaxis_bottom" : null,
      yAxis: orientation === "vertical"   ? "yaxis_left"   : null,
      vertexCount: 4,
      colorAxes: {
        // data [0,1] is a dummy for schema purposes; the actual range is always
        // synced from the target plot's color axis at render time by Colorbar.
        v: { quantityKind: colorAxis, data: new Float32Array([0, 1]), colorscale: "viridis" }
      }
    }
  }
})

registerLayerType("colorbar", colorbarLayerType)
