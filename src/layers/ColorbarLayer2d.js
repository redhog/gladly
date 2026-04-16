import { LayerType } from "../core/LayerType.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

const quadCx = new Float32Array([-1, 1, -1, 1])
const quadCy = new Float32Array([-1, -1, 1, 1])

const COLORBAR2D_VERT = `#version 300 es
    precision mediump float;
    in float cx;
    in float cy;
    out float tval_x;
    out float tval_y;
    void main() {
      gl_Position = vec4(cx, cy, 0.0, 1.0);
      tval_x = (cx + 1.0) / 2.0;
      tval_y = (cy + 1.0) / 2.0;
    }
  `

// tval_x/tval_y are [0,1] positions in the colorbar quad. We convert them to actual data
// values in each axis's range (undoing the log transform if needed), then pass those raw
// values to map_color_s_2d which re-applies the scale type internally. The exp() call
// is the inverse of the log() that map_color_s_2d will apply, so log-scale roundtrips
// correctly and linear-scale is a no-op (exp(log(v)) == v, but for linear vt == v anyway).
const COLORBAR2D_FRAG = `#version 300 es
    precision mediump float;
    uniform vec2 color_range_a;
    uniform float color_scale_type_a;
    uniform vec2 color_range_b;
    uniform float color_scale_type_b;
    in float tval_x;
    in float tval_y;
    void main() {
      float r0_a = color_scale_type_a > 0.5 ? log(color_range_a.x) : color_range_a.x;
      float r1_a = color_scale_type_a > 0.5 ? log(color_range_a.y) : color_range_a.y;
      float vt_a = r0_a + tval_x * (r1_a - r0_a);
      float v_a  = color_scale_type_a > 0.5 ? exp(vt_a) : vt_a;

      float r0_b = color_scale_type_b > 0.5 ? log(color_range_b.x) : color_range_b.x;
      float r1_b = color_scale_type_b > 0.5 ? log(color_range_b.y) : color_range_b.y;
      float vt_b = r0_b + tval_y * (r1_b - r0_b);
      float v_b  = color_scale_type_b > 0.5 ? exp(vt_b) : vt_b;

      fragColor = map_color_2d_(vec2(v_a, v_b));
    }
  `

class Colorbar2dLayerType extends LayerType {
  constructor() {
    super({ name: "colorbar2d", suppressWarnings: true, vert: COLORBAR2D_VERT, frag: COLORBAR2D_FRAG })
  }

  _getAxisConfig(parameters) {
    const { xAxis, yAxis } = parameters
    return {
      xAxis: "xaxis_bottom",
      xAxisQuantityKind: xAxis,
      yAxis: "yaxis_left",
      yAxisQuantityKind: yAxis,
      colorAxisQuantityKinds: { '_a': xAxis, '_b': yAxis },
      colorAxis2dQuantityKinds: { '': ['_a', '_b'] },
    }
  }

  schema() {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        xAxis: { type: "string", description: "Quantity kind for the x axis (color axis A)" },
        yAxis: { type: "string", description: "Quantity kind for the y axis (color axis B)" }
      },
      required: ["xAxis", "yAxis"]
    }
  }

  _createLayer() {
    return [{
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: {},
      primitive: "triangle strip",
      vertexCount: 4,
    }]
  }
}

export const colorbar2dLayerType = new Colorbar2dLayerType()
registerLayerType("colorbar2d", colorbar2dLayerType)
export { Colorbar2dLayerType }
