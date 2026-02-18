import { LayerType } from "./LayerType.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

export const filterbarLayerType = new LayerType({
  name: "filterbar",
  axisQuantityKinds: { x: null, y: null },
  primitive: "points",

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
    void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }
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

  getAxisQuantityKinds: function(parameters) {
    const { filterAxis, orientation = "horizontal" } = parameters
    // The axis that runs along the filter range gets the filterAxis quantity kind as its unit,
    // so that Plot renders the correct label. The unused direction gets a placeholder that is
    // never registered because that axis is set to null in createLayer.
    return {
      x: orientation === "horizontal" ? filterAxis : "meters",
      y: orientation === "vertical"   ? filterAxis : "meters"
    }
  },

  createLayer: function(parameters) {
    const { filterAxis, orientation = "horizontal" } = parameters
    return {
      attributes:  {},
      uniforms:    {},
      xAxis:       orientation === "horizontal" ? "xaxis_bottom" : null,
      yAxis:       orientation === "vertical"   ? "yaxis_left"   : null,
      vertexCount: 0,
      colorAxes:   {},
      filterAxes:  {}
    }
  }
})

registerLayerType("filterbar", filterbarLayerType)
