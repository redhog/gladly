import { ComputedData, registerComputedData, EXPRESSION_REF, resolveAttributeExpr, isTexture } from "./ComputationRegistry.js"

function liveTextureShape(regl, N) {
  const maxTexSize = regl.limits.maxTextureSize
  const w = Math.min(N, maxTexSize)
  const h = Math.ceil(N / w)
  return [w, h]
}

// Walk an expression tree looking for the first string column reference,
// then return the length of that column's data.
function detectLength(expr, data) {
  if (typeof expr === 'string') {
    const val = data?.getData(expr)
    if (val instanceof Float32Array) return val.length
    if (val?._isLive) return val.texture.width * val.texture.height
    if (isTexture(val)) return val.width * val.height
    return null
  }
  if (expr && typeof expr === 'object' && !expr._isLive) {
    for (const v of Object.values(expr)) {
      const n = detectLength(v, data)
      if (n !== null) return n
    }
  }
  return null
}

function evalExpr(regl, expr, outName, N, plotProxy) {
  const resolved = resolveAttributeExpr(regl, expr, outName, plotProxy)
  const [liveW, liveH] = liveTextureShape(regl, N)

  if (resolved.kind === 'buffer') {
    // Copy Float32Array into a non-packed texture (one value per texel in R channel)
    const texData = new Float32Array(liveW * liveH * 4)
    const src = resolved.value
    for (let i = 0; i < src.length && i < N; i++) texData[i * 4] = src[i]
    return regl.texture({ data: texData, shape: [liveW, liveH], type: 'float', format: 'rgba' })
  }

  // kind: 'computed' — run a GPU point-render pass to evaluate the GLSL expression
  const { glslExpr, context } = resolved

  const pickIds = new Float32Array(N)
  for (let i = 0; i < N; i++) pickIds[i] = i

  const outputTex = regl.texture({ width: liveW, height: liveH, type: 'float', format: 'rgba' })
  const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })

  const vert = `#version 300 es
precision highp float;
in float a_pickId;
${context.globalDecls.join('\n')}
out float v_value;
void main() {
  float tx = mod(a_pickId, ${liveW}.0);
  float ty = floor(a_pickId / ${liveW}.0);
  float x = (tx + 0.5) / ${liveW}.0 * 2.0 - 1.0;
  float y = (ty + 0.5) / ${liveH}.0 * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_value = ${glslExpr};
}`

  const frag = `#version 300 es
precision highp float;
in float v_value;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_value, 0.0, 0.0, 1.0);
}`

  const uniforms = {}
  for (const [k, v] of Object.entries(context.textureUniforms)) uniforms[k] = v
  for (const [k, v] of Object.entries(context.scalarUniforms)) uniforms[k] = v

  regl({
    framebuffer: outputFBO,
    vert,
    frag,
    attributes: { a_pickId: pickIds, ...context.bufferAttrs },
    uniforms,
    count: N,
    primitive: 'points'
  })()

  return outputTex
}

class ElementwiseData extends ComputedData {
  columns(params) {
    if (!params?.columns) return []
    return params.columns.map(c => c.dst)
  }

  compute(regl, params, data, getAxisDomain) {
    const plotProxy = { currentData: data, getAxisDomain }

    let N = params.dataLength ?? null
    if (N == null) {
      for (const { src } of params.columns) {
        N = detectLength(src, data)
        if (N !== null) break
      }
    }
    if (N == null) throw new Error('ElementwiseData: cannot determine data length; set dataLength param')

    const result = {}
    for (const { dst, src } of params.columns) {
      result[dst] = evalExpr(regl, src, dst, N, plotProxy)
    }
    return result
  }

  schema(data) {
    return {
      type: 'object',
      title: 'ElementwiseData',
      properties: {
        dataLength: {
          type: 'integer',
          description: 'Override output length (optional, auto-detected from column refs)'
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dst: { type: 'string', description: 'Output column name' },
              src: EXPRESSION_REF
            },
            required: ['dst', 'src']
          }
        }
      },
      required: ['columns']
    }
  }
}

registerComputedData('ElementwiseData', new ElementwiseData())
