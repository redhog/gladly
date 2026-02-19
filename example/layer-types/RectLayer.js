import { LayerType } from "../../src/LayerType.js"
import { AXES } from "../../src/AxisRegistry.js"
import { registerLayerType } from "../../src/LayerTypeRegistry.js"

// Per-vertex quad corner coordinates for two CCW triangles: BL-BR-TR, BL-TR-TL
const QUAD_CX = new Float32Array([0, 1, 1, 0, 1, 0])
const QUAD_CY = new Float32Array([0, 0, 1, 0, 1, 1])

export const rectLayerType = new LayerType({
  name: "rects",
  xAxis: "xaxis_bottom",
  yAxis: "yaxis_left",

  getAxisConfig: function(params) {
    return {
      xAxis: params.xAxis,
      xAxisQuantityKind: params.xData,
      yAxis: params.yAxis,
      yAxisQuantityKind: params.yTopData,
      colorAxisQuantityKinds: [params.vData],
    }
  },

  // GLSL ES 1.00 — uses instanced attributes; cx/cy are per-vertex, rest are per-instance.
  vert: `
    precision mediump float;
    attribute float cx;
    attribute float cy;
    attribute float x;
    attribute float xPrev;
    attribute float xNext;
    attribute float top;
    attribute float bot;
    attribute float color_data;
    uniform float uE;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    uniform float xScaleType;
    uniform float yScaleType;
    varying float value;

    void main() {
      float halfLeft  = (x - xPrev) / 2.0;
      float halfRight = (xNext - x) / 2.0;

      // Cap: if one side exceeds e, use the other side's value (simultaneous, using originals).
      float hl = halfLeft  > uE ? halfRight : halfLeft;
      float hr = halfRight > uE ? halfLeft  : halfRight;

      float xPos = cx > 0.5 ? x + hr : x - hl;
      float yPos = cy > 0.5 ? top : bot;

      float nx = normalize_axis(xPos, xDomain, xScaleType);
      float ny = normalize_axis(yPos, yDomain, yScaleType);
      gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
      value = color_data;
    }
  `,

  frag: `
    precision mediump float;
    uniform int colorscale;
    uniform vec2 color_range;
    uniform float color_scale_type;
    varying float value;

    void main() {
      gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type);
    }
  `,

  schema: (data) => {
    const dataProperties = data ? Object.keys(data) : []
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        xData:       { type: "string", enum: dataProperties, description: "Data key for x positions (rect centers)" },
        yTopData:    { type: "string", enum: dataProperties, description: "Data key for top y values" },
        yBottomData: { type: "string", enum: dataProperties, description: "Data key for bottom y values" },
        vData:       { type: "string", enum: dataProperties, description: "Data key for color values; also used as the color axis quantity kind" },
        e:           { type: "number", description: "Max half-width cap. If half-distance to a neighbor exceeds this, the opposite half-width is used instead." },
        xAxis: { type: "string", enum: AXES.filter(a => a.includes("x")), default: "xaxis_bottom" },
        yAxis: { type: "string", enum: AXES.filter(a => a.includes("y")), default: "yaxis_left" },
      },
      required: ["xData", "yTopData", "yBottomData", "vData"],
    }
  },

  createLayer: function(params, data) {
    const { xData, yTopData, yBottomData, vData, e = Infinity } = params

    const x   = data[xData]
    const top = data[yTopData]
    const bot = data[yBottomData]
    const v   = data[vData]

    if (!x)   throw new Error(`Data property '${xData}' not found`)
    if (!top) throw new Error(`Data property '${yTopData}' not found`)
    if (!bot) throw new Error(`Data property '${yBottomData}' not found`)
    if (!v)   throw new Error(`Data property '${vData}' not found`)

    const n = x.length

    // Build neighbor arrays using TypedArray.set() — no explicit loops.
    const xPrev = new Float32Array(n)
    xPrev.set(x.subarray(0, n - 1), 1)
    xPrev[0] = n > 1 ? 2 * x[0] - x[1] : x[0]

    const xNext = new Float32Array(n)
    xNext.set(x.subarray(1), 0)
    xNext[n - 1] = n > 1 ? 2 * x[n - 1] - x[n - 2] : x[n - 1]

    // Compute domains for auto-range (no explicit for loops).
    const xMin   = x.reduce((a, v) => Math.min(a, v), Infinity)
    const xMax   = x.reduce((a, v) => Math.max(a, v), -Infinity)
    const topMin = top.reduce((a, v) => Math.min(a, v), Infinity)
    const topMax = top.reduce((a, v) => Math.max(a, v), -Infinity)
    const botMin = bot.reduce((a, v) => Math.min(a, v), Infinity)
    const botMax = bot.reduce((a, v) => Math.max(a, v), -Infinity)

    return [{
      attributes: {
        cx: QUAD_CX,  // per-vertex (divisor 0)
        cy: QUAD_CY,  // per-vertex (divisor 0)
        x,            // per-instance (divisor 1)
        xPrev,        // per-instance (divisor 1)
        xNext,        // per-instance (divisor 1)
        top,          // per-instance (divisor 1)
        bot,          // per-instance (divisor 1)
        [vData]: v,   // per-instance color data, keyed by quantity kind (divisor 1)
      },
      attributeDivisors: { x: 1, xPrev: 1, xNext: 1, top: 1, bot: 1, [vData]: 1 },
      uniforms: { uE: e },
      nameMap: {
        [vData]:                      'color_data',
        [`colorscale_${vData}`]:      'colorscale',
        [`color_range_${vData}`]:     'color_range',
        [`color_scale_type_${vData}`]:'color_scale_type',
      },
      domains: {
        [xData]:    [xMin, xMax],
        [yTopData]: [Math.min(topMin, botMin), Math.max(topMax, botMax)],
      },
      primitive: "triangles",
      vertexCount: 6,
      instanceCount: n,
    }]
  },
})

registerLayerType("rects", rectLayerType)
