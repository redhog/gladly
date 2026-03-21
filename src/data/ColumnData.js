// ─── GLSL helper injected into any shader that samples column data ─────────────
// Values are packed 4 per texel (RGBA). Element i → texel i/4, channel i%4.
export const SAMPLE_COLUMN_GLSL = `float sampleColumn(sampler2D tex, float idx) {
  ivec2 sz = textureSize(tex, 0);
  int i = int(idx);
  int texelI = i / 4;
  int chan = i % 4;
  ivec2 coord = ivec2(texelI % sz.x, texelI / sz.x);
  vec4 texel = texelFetch(tex, coord, 0);
  if (chan == 0) return texel.r;
  if (chan == 1) return texel.g;
  if (chan == 2) return texel.b;
  return texel.a;
}`

// ─── GLSL helper for multi-dimensional column sampling ───────────────────────
// shape.xyzw holds the size of each logical dimension (unused dims = 1).
// idx is the multi-dimensional index, row-major (first dim varies fastest).
export const SAMPLE_COLUMN_ND_GLSL = `float sampleColumnND(sampler2D tex, ivec4 shape, ivec4 idx) {
  int i = idx.x + shape.x * (idx.y + shape.y * (idx.z + shape.z * idx.w));
  ivec2 sz = textureSize(tex, 0);
  int texelI = i / 4;
  int chan = i % 4;
  ivec2 coord = ivec2(texelI % sz.x, texelI / sz.x);
  vec4 texel = texelFetch(tex, coord, 0);
  if (chan == 0) return texel.r;
  if (chan == 1) return texel.g;
  if (chan == 2) return texel.b;
  return texel.a;
}`

// Upload a Float32Array as a 2D RGBA texture with 4 values packed per texel.
export function uploadToTexture(regl, array) {
  const nTexels = Math.ceil(array.length / 4)
  const w = Math.min(nTexels, regl.limits.maxTextureSize)
  const h = Math.ceil(nTexels / w)
  const texData = new Float32Array(w * h * 4)
  for (let i = 0; i < array.length; i++) texData[i] = array[i]
  const tex = regl.texture({ data: texData, shape: [w, h], type: 'float', format: 'rgba' })
  tex._dataLength = array.length
  return tex
}

// ─── ColumnData base class ────────────────────────────────────────────────────
export class ColumnData {
  get length()       { return null }
  get domain()       { return null }
  get quantityKind() { return null }
  get shape()        { return [this.length] }
  get ndim()         { return this.shape.length }
  get totalLength()  { return this.shape.reduce((a, b) => a * b, 1) }

  // Returns { glslExpr: string, textures: { uniformName: () => reglTexture } }
  // path must be a valid GLSL identifier fragment (no dots or special chars)
  resolve(path, regl) { throw new Error('Not implemented') }

  // Returns a regl texture (4 values per texel, RGBA, 2D layout).
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
  constructor(array, { domain = null, quantityKind = null, shape = null } = {}) {
    super()
    this._array = array
    this._domain = domain
    this._quantityKind = quantityKind
    this._shape = shape
    this._ref = null  // { texture } lazy
  }

  get length()       { return this._array.length }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }
  get array()        { return this._array }
  get shape()        { return this._shape ?? [this._array.length] }

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
    const shape = this.shape
    if (shape.length === 1) {
      return { glslExpr: `sampleColumn(${uName}, a_pickId)`, textures: { [uName]: () => ref.texture }, shape }
    }
    return { glslExpr: null, textures: { [uName]: () => ref.texture }, shape }
  }

  toTexture(regl) { return this._upload(regl).texture }
}

// ─── TextureColumn ────────────────────────────────────────────────────────────
export class TextureColumn extends ColumnData {
  constructor(ref, { domain = null, quantityKind = null, length = null, refreshFn = null, shape = null } = {}) {
    super()
    this._ref = ref           // { texture } mutable so hot-swaps propagate
    this._domain = domain
    this._quantityKind = quantityKind
    this._length = length
    this._refreshFn = refreshFn
    this._shape = shape
  }

  get length()       { return this._length }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }
  get shape()        { return this._shape ?? (this._length != null ? [this._length] : [0]) }

  resolve(path, regl) {
    if (!this._ref.texture) {
      throw new Error(`[gladly] TextureColumn '${path}': texture is null — the column was not properly initialized or its computation failed`)
    }
    const uName = `u_col_${path}`
    const texFn = () => {
      if (!this._ref.texture) throw new Error(`[gladly] TextureColumn '${path}': texture became null after initialization`)
      return this._ref.texture
    }
    const shape = this.shape
    if (shape.length === 1) {
      return { glslExpr: `sampleColumn(${uName}, a_pickId)`, textures: { [uName]: texFn }, shape }
    }
    return { glslExpr: null, textures: { [uName]: texFn }, shape }
  }

  toTexture(regl) {
    if (!this._ref.texture) {
      throw new Error(`[gladly] TextureColumn.toTexture(): texture is null — the column was not properly initialized`)
    }
    return this._ref.texture
  }

  async refresh(plot) {
    if (this._refreshFn) return await this._refreshFn(plot, this._ref) ?? false
    return false
  }
}

// ─── GlslColumn ───────────────────────────────────────────────────────────────
export class GlslColumn extends ColumnData {
  constructor(inputs, glslFn, { domain = null, quantityKind = null, shape = null } = {}) {
    super()
    this._inputs = inputs       // { name: ColumnData }
    this._glslFn = glslFn       // (resolvedExprs: { name: string }) => string
    this._domain = domain
    this._quantityKind = quantityKind
    this._targetShape = shape   // logical output shape (null = 1D, infer from inputs)
  }

  get length() {
    if (this._targetShape) return this._targetShape.reduce((a, b) => a * b, 1)
    return Object.values(this._inputs)[0]?.length ?? null
  }
  get domain()       { return this._domain }
  get quantityKind() { return this._quantityKind }
  get shape() {
    if (this._targetShape) return this._targetShape
    const l = Object.values(this._inputs)[0]?.length ?? null
    return l != null ? [l] : [0]
  }

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
    const nTexels = Math.ceil(N / 4)
    const w = Math.min(nTexels, regl.limits.maxTextureSize)
    const h = Math.ceil(nTexels / w)
    const { glslExpr, textures } = this.resolve('glsl_mat', regl)
    const samplerDecls = Object.keys(textures).map(n => `uniform sampler2D ${n};`).join('\n')
    const vert = `#version 300 es
precision highp float;
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`
    const frag = `#version 300 es
precision highp float;
precision highp sampler2D;
${samplerDecls}
${SAMPLE_COLUMN_GLSL}
out vec4 fragColor;
float gladly_eval(float a_pickId) {
  return ${glslExpr};
}
void main() {
  int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
  int base = texelI * 4;
  float v0 = base + 0 < ${N} ? gladly_eval(float(base + 0)) : 0.0;
  float v1 = base + 1 < ${N} ? gladly_eval(float(base + 1)) : 0.0;
  float v2 = base + 2 < ${N} ? gladly_eval(float(base + 2)) : 0.0;
  float v3 = base + 3 < ${N} ? gladly_eval(float(base + 3)) : 0.0;
  fragColor = vec4(v0, v1, v2, v3);
}`
    const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
    const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })
    const uniforms = {}
    for (const [k, fn] of Object.entries(textures)) uniforms[k] = fn
    regl({
      framebuffer: outputFBO, vert, frag,
      attributes: { a_position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
      uniforms,
      count: 4,
      primitive: 'triangle strip'
    })()
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
  get shape()        { return this._base.shape }

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
