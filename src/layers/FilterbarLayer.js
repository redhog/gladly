import { LayerType } from "../core/LayerType.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

export const filterbarLayerType = new LayerType({
  name: "filterbar",

  getAxisConfig: function(parameters) {
    const { filterAxis, orientation = "horizontal" } = parameters
    return {
      xAxis: orientation === "horizontal" ? "xaxis_bottom" : null,
      xAxisQuantityKind: orientation === "horizontal" ? filterAxis : undefined,
      yAxis: orientation === "vertical" ? "yaxis_left" : null,
      yAxisQuantityKind: orientation === "vertical" ? filterAxis : undefined,
    }
  },

  // Nothing is rendered — vertexCount is always 0.
  // These minimal shaders satisfy the WebGL compiler but never execute.
  vert: `
    precision mediump float;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }
  `,
  frag: `
    precision mediump float;
    void main() { gl_FragColor = gladly_apply_color(vec4(0.0, 0.0, 0.0, 0.0)); }
  `,

  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      filterAxis:  { type: "string", description: "Quantity kind of the filter axis to display" },
      orientation: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }
    },
    required: ["filterAxis"]
  }),

  createLayer: function() {
    return [{
      attributes: {},
      uniforms:   {},
      vertexCount: 0,
    }]
  }
})

registerLayerType("filterbar", filterbarLayerType)
