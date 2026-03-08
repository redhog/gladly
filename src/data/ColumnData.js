// ─── GLSL helper injected into any shader that samples column data ─────────────
export const SAMPLE_COLUMN_GLSL = `float sampleColumn(sampler2D tex, float idx) {
  ivec2 sz = textureSize(tex, 0);
  int i = int(idx);
  return texelFetch(tex, ivec2(i % sz.x, i / sz.x), 0).r;
}`

// Upload a Float32Array as a 2D RGBA texture with values in the R channel.
export function uploadToTexture(regl, array) {
  const w = Math.min(array.length, regl.limits.maxTextureSize)
  const h = Math.ceil(array.length / w)
  const texData = new Float32Array(w * h * 4)
  for (let i = 0; i < array.length; i++) texData[i * 4] = array[i]
  const tex = regl.texture({ data: texData, shape: [w, h], type: 'float', format: 'rgba' })
  tex._dataLength = array.length
  return tex
}

// ─── ColumnData base class ────────────────────────────────────────────────────
export class ColumnData {
  get length()       { return null }
  get domain()       { return null }
  get quantityKind() { return null }

  // Returns { glslExpr: string, textures: { uniformName: () => reglTexture } }
  // path must be a valid GLSL identifier fragment (no dots or special chars)
  resolve(path, regl) { throw new Error('Not implemented') }

  // Returns a regl texture (R channel, 1 value per texel, 2D layout).
  // May run a GPU render pass for GlslColumn.
  toTexture(regl) { throw new Error('Not implemented') }

  // Called before each render to refresh axis-dependent textures.
  // Returns true if the texture was updated.
  refresh(plot) { return false }

  // Returns a new ColumnData that samples at a_pickId + (offsetExpr) instead of a_pickId.
  // offsetExpr is a GLSL expression string, e.g. 'a_endPoint' or '1.0'.
  withOffset(offsetExpr) { return new OffsetColumn(this, offsetExpr) }
}

// ─── ArrayColumn ──────────────────────────────────────────────────────────────
export class ArrayColumn extends ColumnData {
  constructor(array, { domain = null, quantityKind = null } = {}) {
    super()
    this._array = array
    this._domain = domain
    this._quantityKind = quantityKind
    this._ref = null  // { texture } lazy
  }

  get length()       { return this._array.length }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }
  get array()        { return this._array }

  _upload(regl) {
    if (this._array.length === 0) {
      throw new Error(`[gladly] ArrayColumn: cannot upload empty array as texture — the data source has 0 elements`)
    }
    if (!this._ref) this._ref = { texture: uploadToTexture(regl, this._array) }
    return this._ref
  }

  resolve(path, regl) {
    const ref = this._upload(regl)
    const uName = `u_col_${path}`
    return {
      glslExpr: `sampleColumn(${uName}, a_pickId)`,
      textures: { [uName]: () => ref.texture }
    }
  }

  toTexture(regl) { return this._upload(regl).texture }
}

// ─── TextureColumn ────────────────────────────────────────────────────────────
export class TextureColumn extends ColumnData {
  constructor(ref, { domain = null, quantityKind = null, length = null, refreshFn = null } = {}) {
    super()
    this._ref = ref           // { texture } mutable so hot-swaps propagate
    this._domain = domain
    this._quantityKind = quantityKind
    this._length = length
    this._refreshFn = refreshFn
  }

  get length()       { return this._length }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }

  resolve(path, regl) {
    if (!this._ref.texture) {
      throw new Error(`[gladly] TextureColumn '${path}': texture is null — the column was not properly initialized or its computation failed`)
    }
    const uName = `u_col_${path}`
    return {
      glslExpr: `sampleColumn(${uName}, a_pickId)`,
      textures: { [uName]: () => {
        if (!this._ref.texture) throw new Error(`[gladly] TextureColumn '${path}': texture became null after initialization`)
        return this._ref.texture
      }}
    }
  }

  toTexture(regl) {
    if (!this._ref.texture) {
      throw new Error(`[gladly] TextureColumn.toTexture(): texture is null — the column was not properly initialized`)
    }
    return this._ref.texture
  }

  refresh(plot) {
    if (this._refreshFn) return this._refreshFn(plot, this._ref) ?? false
    return false
  }
}

// ─── GlslColumn ───────────────────────────────────────────────────────────────
export class GlslColumn extends ColumnData {
  constructor(inputs, glslFn, { domain = null, quantityKind = null } = {}) {
    super()
    this._inputs = inputs   // { name: ColumnData }
    this._glslFn = glslFn   // (resolvedExprs: { name: string }) => string
    this._domain = domain
    this._quantityKind = quantityKind
  }

  get length()       { return Object.values(this._inputs)[0]?.length ?? null }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }

  resolve(path, regl) {
    const resolvedExprs = {}
    const textures = {}
    for (const [name, col] of Object.entries(this._inputs)) {
      const { glslExpr, textures: colTextures } = col.resolve(`${path}_${name}`, regl)
      resolvedExprs[name] = glslExpr
      Object.assign(textures, colTextures)
    }
    return { glslExpr: this._glslFn(resolvedExprs), textures }
  }

  toTexture(regl) {
    const N = this.length
    if (N === null) throw new Error('GlslColumn: cannot determine length for toTexture()')
    const w = Math.min(N, regl.limits.maxTextureSize)
    const h = Math.ceil(N / w)
    const { glslExpr, textures } = this.resolve('glsl_mat', regl)
    const pickIds = new Float32Array(N)
    for (let i = 0; i < N; i++) pickIds[i] = i
    const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
    const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })
    const samplerDecls = Object.keys(textures).map(n => `uniform sampler2D ${n};`).join('\n')
    const vert = `#version 300 es
precision highp float;
precision highp sampler2D;
in float a_pickId;
${samplerDecls}
${SAMPLE_COLUMN_GLSL}
out float v_value;
void main() {
  float tx = mod(a_pickId, ${w}.0);
  float ty = floor(a_pickId / ${w}.0);
  float x = (tx + 0.5) / ${w}.0 * 2.0 - 1.0;
  float y = (ty + 0.5) / ${h}.0 * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_value = ${glslExpr};
}`
    const frag = `#version 300 es
precision highp float;
in float v_value;
out vec4 fragColor;
void main() { fragColor = vec4(v_value, 0.0, 0.0, 1.0); }`
    const uniforms = {}
    for (const [k, fn] of Object.entries(textures)) uniforms[k] = fn
    regl({ framebuffer: outputFBO, vert, frag,
      attributes: { a_pickId: pickIds }, uniforms, count: N, primitive: 'points' })()
    outputTex._dataLength = N
    return outputTex
  }

  refresh(plot) {
    let changed = false
    for (const col of Object.values(this._inputs)) {
      if (col.refresh(plot)) changed = true
    }
    return changed
  }
}

// ─── OffsetColumn ─────────────────────────────────────────────────────────────
// Wraps a ColumnData and shifts the GLSL sampling index by a GLSL expression.
// Produced by col.withOffset(offsetExpr).
export class OffsetColumn extends ColumnData {
  constructor(base, offsetExpr) {
    super()
    this._base = base
    this._offsetExpr = offsetExpr
  }

  get length()       { return this._base.length }
  get domain()       { return this._base.domain }
  get quantityKind() { return this._base.quantityKind }

  resolve(path, regl) {
    const { glslExpr, textures } = this._base.resolve(path, regl)
    return {
      glslExpr: glslExpr.replace('a_pickId', `(a_pickId + (${this._offsetExpr}))`),
      textures
    }
  }

  toTexture(regl) { return this._base.toTexture(regl) }
  refresh(plot)   { return this._base.refresh(plot) }
}
