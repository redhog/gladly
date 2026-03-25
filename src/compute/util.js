import { registerTextureComputation, registerGlslComputation, EXPRESSION_REF } from "./ComputationRegistry.js"
import { TextureComputation, GlslComputation } from "../data/Computation.js"
import { GlslColumn } from "../data/ColumnData.js"

// Shared helper: allocate an output texture + FBO and run a fullscreen quad.
function runFullscreenQuad(regl, N, fragGlsl, uniforms = {}) {
  const nTexels = Math.ceil(N / 4)
  const w = Math.min(nTexels, regl.limits.maxTextureSize)
  const h = Math.ceil(nTexels / w)
  const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
  const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })
  regl({
    framebuffer: outputFBO,
    vert: `#version 300 es
precision highp float;
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`,
    frag: fragGlsl(w),
    attributes: { a_position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
    uniforms,
    count: 4,
    primitive: 'triangle strip'
  })()
  outputTex._dataLength = N
  return outputTex
}

// ─── linspace ─────────────────────────────────────────────────────────────────
// Produces N values in ]0, 1[ : value[i] = (i + 0.5) / N  — fully on GPU.
class LinspaceComputation extends TextureComputation {
  compute(regl, inputs, _getAxisDomain) {
    const N = inputs.length
    return runFullscreenQuad(regl, N, w => `#version 300 es
precision highp float;
uniform int u_N;
out vec4 fragColor;
float linVal(int idx) { return (float(idx) + 0.5) / float(u_N); }
void main() {
  int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
  int base = texelI * 4;
  fragColor = vec4(
    base + 0 < u_N ? linVal(base + 0) : 0.0,
    base + 1 < u_N ? linVal(base + 1) : 0.0,
    base + 2 < u_N ? linVal(base + 2) : 0.0,
    base + 3 < u_N ? linVal(base + 3) : 0.0
  );
}`, { u_N: N })
  }

  schema(_data) {
    return {
      type: 'object',
      title: 'linspace',
      properties: {
        length: { type: 'integer', description: 'Number of values' }
      },
      required: ['length']
    }
  }
}

registerTextureComputation('linspace', new LinspaceComputation())

// ─── range ────────────────────────────────────────────────────────────────────
// Produces N integer values: 0, 1, 2, ..., N-1  — fully on GPU.
class RangeComputation extends TextureComputation {
  compute(regl, inputs, _getAxisDomain) {
    const N = inputs.length
    return runFullscreenQuad(regl, N, w => `#version 300 es
precision highp float;
uniform int u_N;
out vec4 fragColor;
void main() {
  int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
  int base = texelI * 4;
  fragColor = vec4(
    base + 0 < u_N ? float(base + 0) : 0.0,
    base + 1 < u_N ? float(base + 1) : 0.0,
    base + 2 < u_N ? float(base + 2) : 0.0,
    base + 3 < u_N ? float(base + 3) : 0.0
  );
}`, { u_N: N })
  }

  schema(_data) {
    return {
      type: 'object',
      title: 'range',
      properties: {
        length: { type: 'integer', description: 'Number of values' }
      },
      required: ['length']
    }
  }
}

registerTextureComputation('range', new RangeComputation())

// ─── glslExpr ─────────────────────────────────────────────────────────────────
// A GlslComputation where the GLSL expression is a user-supplied string.
// Named inputs are referenced in expr as {name} placeholders.
//
// Example:
//   { glslExpr: { expr: "sin({x}) * {y}", inputs: { x: "col1", y: "col2" } } }
class GlslExprComputation extends GlslComputation {
  glsl(_resolvedExprs) { throw new Error('glslExpr: use createColumn, not glsl()') }

  createColumn(inputs) {
    const expr = inputs.expr       // raw string from user
    const colInputs = inputs.inputs ?? {}
    return new GlslColumn(colInputs, (resolvedExprs) => {
      let result = expr
      for (const [name, glslExpr] of Object.entries(resolvedExprs)) {
        result = result.replaceAll(`{${name}}`, glslExpr)
      }
      return result
    })
  }

  schema(data) {
    return {
      type: 'object',
      title: 'glslExpr',
      properties: {
        expr: {
          type: 'string',
          description: 'GLSL expression; reference inputs as {name} placeholders'
        },
        inputs: {
          type: 'object',
          additionalProperties: EXPRESSION_REF,
          description: 'Named input columns referenced in expr as {name}'
        }
      },
      required: ['expr']
    }
  }
}

registerGlslComputation('glslExpr', new GlslExprComputation())

// ─── random ───────────────────────────────────────────────────────────────────
// Produces N pseudorandom values in ]0, 1[ derived from index ^ seed.
// All computation is done on the GPU via a fullscreen quad render pass.
// Hash: 3-round xorshift-multiply (good avalanche, no trig, GLSL ES 300).
class RandomComputation extends TextureComputation {
  compute(regl, inputs, _getAxisDomain) {
    const N    = inputs.length
    const seed = (inputs.seed || 0) === 0 ? (Math.random() * 0x7fffffff) | 0 : inputs.seed
    return runFullscreenQuad(regl, N, w => `#version 300 es
precision highp float;
uniform int u_seed;
uniform int u_N;
out vec4 fragColor;

uint uhash(uint x) {
  x ^= x >> 17u;
  x *= 0xbf324c81u;
  x ^= x >> 11u;
  x *= 0x68bc4b39u;
  x ^= x >> 16u;
  return x;
}

// Maps uint to ]0, 1[ : (bits + 0.5) / 2^24
float randVal(int idx) {
  uint h = uhash(uint(idx) ^ uint(u_seed));
  return (float(h >> 8u) + 0.5) / 16777216.0;
}

void main() {
  int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
  int base = texelI * 4;
  fragColor = vec4(
    base + 0 < u_N ? randVal(base + 0) : 0.0,
    base + 1 < u_N ? randVal(base + 1) : 0.0,
    base + 2 < u_N ? randVal(base + 2) : 0.0,
    base + 3 < u_N ? randVal(base + 3) : 0.0
  );
}`, { u_seed: seed | 0, u_N: N })
  }

  schema(_data) {
    return {
      type: 'object',
      title: 'random',
      properties: {
        length: { type: 'integer', description: 'Number of values' },
        seed:   { type: 'integer', description: 'Integer seed (default 0)', default: 0 }
      },
      required: ['length']
    }
  }
}

registerTextureComputation('random', new RandomComputation())
