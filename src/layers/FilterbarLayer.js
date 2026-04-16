import { LayerType } from "../core/LayerType.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

// Nothing is rendered — vertexCount is always 0.
// These minimal shaders satisfy the WebGL compiler but never execute.
const FILTERBAR_VERT = `#version 300 es
    precision mediump float;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }
  `

const FILTERBAR_FRAG = `#version 300 es
    precision mediump float;
    void main() { fragColor = gladly_apply_color(vec4(0.0, 0.0, 0.0, 0.0)); }
  `

class FilterbarLayerType extends LayerType {
  constructor() {
    super({ name: "filterbar", suppressWarnings: true, vert: FILTERBAR_VERT, frag: FILTERBAR_FRAG })
  }

  _getAxisConfig(parameters) {
    const { filterAxis, orientation = "horizontal" } = parameters
    return {
      xAxis: orientation === "horizontal" ? "xaxis_bottom" : null,
      xAxisQuantityKind: orientation === "horizontal" ? filterAxis : undefined,
      yAxis: orientation === "vertical" ? "yaxis_left" : null,
      yAxisQuantityKind: orientation === "vertical" ? filterAxis : undefined,
    }
  }

  schema() {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        filterAxis:  { type: "string", description: "Quantity kind of the filter axis to display" },
        orientation: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }
      },
      required: ["filterAxis"]
    }
  }

  _createLayer() {
    return [{
      attributes: {},
      uniforms:   {},
      vertexCount: 0,
    }]
  }
}

export const filterbarLayerType = new FilterbarLayerType()
registerLayerType("filterbar", filterbarLayerType)
export { FilterbarLayerType }
