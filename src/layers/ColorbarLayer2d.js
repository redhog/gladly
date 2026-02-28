import { LayerType } from "../core/LayerType.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

// Four vertices for a triangle-strip quad covering the entire clip space.
const quadCx = new Float32Array([-1, 1, -1, 1])
const quadCy = new Float32Array([-1, -1, 1, 1])

export const colorbar2dLayerType = new LayerType({
  name: "colorbar2d",

  getAxisConfig: function(parameters) {
    const { xAxis, yAxis } = parameters
    return {
      xAxis: "xaxis_bottom",
      xAxisQuantityKind: xAxis,
      yAxis: "yaxis_left",
      yAxisQuantityKind: yAxis,
      colorAxisQuantityKinds: [xAxis, yAxis],
    }
  },

  vert: `
    precision mediump float;
    attribute float cx;
    attribute float cy;
    varying float tval_x;
    varying float tval_y;
    void main() {
      gl_Position = vec4(cx, cy, 0.0, 1.0);
      tval_x = (cx + 1.0) / 2.0;
      tval_y = (cy + 1.0) / 2.0;
    }
  `,

  // tval_x/tval_y are [0,1] positions in the colorbar quad. We convert them to actual data
  // values in each axis's range (undoing the log transform if needed), then pass those raw
  // values to map_color_s_2d which re-applies the scale type internally. The exp() call
  // is the inverse of the log() that map_color_s_2d will apply, so log-scale roundtrips
  // correctly and linear-scale is a no-op (exp(log(v)) == v, but for linear vt == v anyway).
  frag: `
    precision mediump float;
    uniform int colorscale_a;
    uniform vec2 color_range_a;
    uniform float color_scale_type_a;
    uniform int colorscale_b;
    uniform vec2 color_range_b;
    uniform float color_scale_type_b;
    varying float tval_x;
    varying float tval_y;
    void main() {
      float r0_a = color_scale_type_a > 0.5 ? log(color_range_a.x) : color_range_a.x;
      float r1_a = color_scale_type_a > 0.5 ? log(color_range_a.y) : color_range_a.y;
      float vt_a = r0_a + tval_x * (r1_a - r0_a);
      float v_a  = color_scale_type_a > 0.5 ? exp(vt_a) : vt_a;

      float r0_b = color_scale_type_b > 0.5 ? log(color_range_b.x) : color_range_b.x;
      float r1_b = color_scale_type_b > 0.5 ? log(color_range_b.y) : color_range_b.y;
      float vt_b = r0_b + tval_y * (r1_b - r0_b);
      float v_b  = color_scale_type_b > 0.5 ? exp(vt_b) : vt_b;

      gl_FragColor = map_color_s_2d(
        colorscale_a, color_range_a, v_a, color_scale_type_a,
        colorscale_b, color_range_b, v_b, color_scale_type_b
      );
    }
  `,

  schema: () => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      xAxis: { type: "string", description: "Quantity kind for the x axis (color axis A)" },
      yAxis: { type: "string", description: "Quantity kind for the y axis (color axis B)" }
    },
    required: ["xAxis", "yAxis"]
  }),

  createLayer: function(parameters) {
    const { xAxis, yAxis } = parameters
    return [{
      attributes: { cx: quadCx, cy: quadCy },
      uniforms: {},
      primitive: "triangle strip",
      vertexCount: 4,
      nameMap: {
        [`colorscale_${xAxis}`]:       'colorscale_a',
        [`color_range_${xAxis}`]:      'color_range_a',
        [`color_scale_type_${xAxis}`]: 'color_scale_type_a',
        [`colorscale_${yAxis}`]:       'colorscale_b',
        [`color_range_${yAxis}`]:      'color_range_b',
        [`color_scale_type_${yAxis}`]: 'color_scale_type_b',
      },
    }]
  }
})

registerLayerType("colorbar2d", colorbar2dLayerType)
