import { Data } from '../core/Data.js'

const textureComputations = new Map()
const glslComputations = new Map()
const computedDataRegistry = new Map()

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

function domainsEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a === b
  return a[0] === b[0] && a[1] === b[1]
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
    const uName = `u_col_${path}`
    return {
      glslExpr: `sampleColumn(${uName}, a_pickId)`,
      textures: { [uName]: () => this._ref.texture }
    }
  }

  toTexture(regl) { return this._ref.texture }

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

// ─── resolveExprToColumn ─────────────────────────────────────────────────────
// Turns any expression (string col name, { compName: params }, ColumnData) into ColumnData.
export function resolveExprToColumn(expr, data, regl, plot) {
  if (expr instanceof ColumnData) return expr

  if (typeof expr === 'string') {
    const col = data?.getData(expr)
    if (!col) throw new Error(`Column '${expr}' not found in data`)
    return col
  }

  if (typeof expr === 'object' && expr !== null) {
    const keys = Object.keys(expr)
    if (keys.length === 1) {
      const compName = keys[0]
      const params = expr[compName]

      if (textureComputations.has(compName)) {
        const comp = textureComputations.get(compName)
        const resolvedInputs = resolveParams(params, data, regl, plot)
        return comp.createColumn(regl, resolvedInputs, plot)
      }

      if (glslComputations.has(compName)) {
        const comp = glslComputations.get(compName)
        const resolvedInputs = resolveParams(params, data, regl, plot)
        return comp.createColumn(resolvedInputs)
      }
    }
  }

  throw new Error(`Cannot resolve expression to column: ${JSON.stringify(expr)}`)
}

// Resolve a params dict recursively: column refs -> ColumnData, scalars pass through.
function resolveParams(params, data, regl, plot) {
  if (params === null || params === undefined) return params
  if (typeof params === 'number' || typeof params === 'boolean') return params
  if (params instanceof ColumnData) return params
  if (params instanceof Float32Array) return params

  if (typeof params === 'string') {
    const col = data?.getData(params)
    return col ?? params  // fall back to string value if not a known column
  }

  if (typeof params === 'object') {
    const keys = Object.keys(params)
    if (keys.length === 1 &&
        (textureComputations.has(keys[0]) || glslComputations.has(keys[0]))) {
      return resolveExprToColumn(params, data, regl, plot)
    }
    const resolved = {}
    for (const [k, v] of Object.entries(params)) {
      resolved[k] = resolveParams(v, data, regl, plot)
    }
    return resolved
  }

  return params
}

// ─── Base classes ─────────────────────────────────────────────────────────────
export class Computation {
  schema(data) { throw new Error('Not implemented') }
  getQuantityKind(params, data) { return null }
}

export class ComputedData {
  columns() { throw new Error('Not implemented') }
  compute(regl, params, data, getAxisDomain) { throw new Error('Not implemented') }
  schema(data) { throw new Error('Not implemented') }
}

export class TextureComputation extends Computation {
  // Override: inputs is { name: ColumnData | scalar }, returns raw regl texture.
  compute(regl, inputs, getAxisDomain) { throw new Error('Not implemented') }

  createColumn(regl, inputs, plot) {
    const accessedAxes = new Set()
    const cachedDomains = {}

    const getAxisDomain = (axisId) => {
      accessedAxes.add(axisId)
      return plot ? plot.getAxisDomain(axisId) : null
    }

    const rawTex = this.compute(regl, inputs, getAxisDomain)
    const ref = { texture: rawTex }

    let refreshFn = null
    if (accessedAxes.size > 0) {
      for (const axisId of accessedAxes) {
        cachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
      }

      const comp = this
      refreshFn = (currentPlot, texRef) => {
        // Refresh inputs first; track if any updated
        let inputsRefreshed = false
        for (const val of Object.values(inputs)) {
          if (val instanceof ColumnData && val.refresh(currentPlot)) inputsRefreshed = true
        }

        let ownAxisChanged = false
        for (const axisId of accessedAxes) {
          if (!domainsEqual(currentPlot.getAxisDomain(axisId), cachedDomains[axisId])) {
            ownAxisChanged = true
            break
          }
        }

        if (!inputsRefreshed && !ownAxisChanged) return false

        const newAxes = new Set()
        const newGetter = (axisId) => { newAxes.add(axisId); return currentPlot.getAxisDomain(axisId) }
        texRef.texture = comp.compute(regl, inputs, newGetter)

        accessedAxes.clear()
        for (const axisId of newAxes) {
          accessedAxes.add(axisId)
          cachedDomains[axisId] = currentPlot.getAxisDomain(axisId)
        }
        return true
      }
    }

    return new TextureColumn(ref, {
      length: rawTex._dataLength ?? rawTex.width,
      refreshFn
    })
  }
}

export class GlslComputation extends Computation {
  glsl(resolvedExprs) { throw new Error('Not implemented') }

  createColumn(inputs, meta = {}) {
    return new GlslColumn(inputs, resolvedExprs => this.glsl(resolvedExprs), meta)
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────
export function registerTextureComputation(name, computation) {
  textureComputations.set(name, computation)
}

export function registerGlslComputation(name, computation) {
  glslComputations.set(name, computation)
}

export function registerComputedData(name, instance) {
  computedDataRegistry.set(name, instance)
}

export function getComputedData(name) {
  return computedDataRegistry.get(name)
}

export function getRegisteredComputedData() {
  return computedDataRegistry
}

// ─── resolveAttributeExpr ────────────────────────────────────────────────────
// Entry point from LayerType.createDrawCommand. Returns:
//   { kind: 'buffer', value: Float32Array }                 — fixed geometry
//   { kind: 'computed', glslExpr, textures, col }           — data column
export function resolveAttributeExpr(regl, expr, attrShaderName, plot) {
  if (expr instanceof Float32Array) {
    return { kind: 'buffer', value: expr }
  }

  const data = plot ? plot.currentData : null
  const col = (expr instanceof ColumnData)
    ? expr
    : resolveExprToColumn(expr, data, regl, plot)

  const safePath = attrShaderName.replace(/[^a-zA-Z0-9_]/g, '_')
  const { glslExpr, textures } = col.resolve(safePath, regl)
  return { kind: 'computed', glslExpr, textures, col }
}

// ─── resolveQuantityKind ─────────────────────────────────────────────────────
export function resolveQuantityKind(expr, data) {
  if (expr instanceof ColumnData) return expr.quantityKind
  if (typeof expr === 'string') {
    return (data ? data.getQuantityKind(expr) : null) ?? expr
  }
  if (expr && typeof expr === 'object') {
    const keys = Object.keys(expr)
    if (keys.length === 1) {
      const compName = keys[0]
      const comp = textureComputations.get(compName) ?? glslComputations.get(compName)
      if (comp) return comp.getQuantityKind(expr[compName], data)
    }
  }
  return null
}

// ─── Schema builders ──────────────────────────────────────────────────────────
export const EXPRESSION_REF     = { '$ref': '#/$defs/expression' }
export const EXPRESSION_REF_OPT = { '$ref': '#/$defs/expression_opt' }

export function buildTransformSchema(data) {
  const defs = {}
  for (const [name, comp] of computedDataRegistry) {
    defs[`params_computeddata_${name}`] = comp.schema(data)
  }
  defs.transform_expression = {
    anyOf: [...computedDataRegistry].map(([name]) => ({
      type: 'object',
      title: name,
      properties: { [name]: { '$ref': `#/$defs/params_computeddata_${name}` } },
      required: [name],
      additionalProperties: false
    }))
  }
  return { '$defs': defs }
}

export function computationSchema(data) {
  const cols = data ? data.columns() : []
  const defs = {}

  for (const [name, comp] of textureComputations) {
    defs[`params_${name}`] = comp.schema(data)
  }
  for (const [name, comp] of glslComputations) {
    defs[`params_${name}`] = comp.schema(data)
  }

  defs.expression = {
    anyOf: [
      ...cols.map(col => ({ type: 'string', const: col, enum: [col], title: col, readOnly: true })),
      ...[...textureComputations, ...glslComputations].map(([name]) => ({
        type: 'object',
        title: name,
        properties: { [name]: { '$ref': `#/$defs/params_${name}` } },
        required: [name],
        additionalProperties: false
      }))
    ]
  }

  defs.expression_opt = {
    anyOf: [
      { type: 'string', const: 'none', enum: ['none'], title: 'none', readOnly: true },
      ...defs.expression.anyOf
    ]
  }

  return { '$defs': defs, '$ref': '#/$defs/expression' }
}
