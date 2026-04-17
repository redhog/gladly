import { ColumnData } from '../data/ColumnData.js'

const textureComputations = new Map()
const glslComputations = new Map()
const computedDataRegistry = new Map()

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

// ─── resolveExprToColumn ─────────────────────────────────────────────────────
// Turns any expression (string col name, { compName: params }, ColumnData) into ColumnData.
export async function resolveExprToColumn(expr, data, regl, plot) {
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
        const resolvedInputs = await resolveParams(params, data, regl, plot)
        return await comp.createColumn(regl, resolvedInputs, plot)
      }

      if (glslComputations.has(compName)) {
        const comp = glslComputations.get(compName)
        const resolvedInputs = await resolveParams(params, data, regl, plot)
        return comp.createColumn(resolvedInputs)
      }
    }
  }

  throw new Error(`Cannot resolve expression to column: ${JSON.stringify(expr)}`)
}

// Resolve a params dict recursively: column refs -> ColumnData, scalars pass through.
async function resolveParams(params, data, regl, plot) {
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
      return await resolveExprToColumn(params, data, regl, plot)
    }
    const resolved = {}
    for (const [k, v] of Object.entries(params)) {
      resolved[k] = await resolveParams(v, data, regl, plot)
    }
    return resolved
  }

  return params
}

// ─── resolveAttributeExpr ────────────────────────────────────────────────────
// Entry point from LayerType.createDrawCommand. Returns:
//   { kind: 'buffer', value: Float32Array }                 — fixed geometry
//   { kind: 'computed', glslExpr, textures, col }           — data column
export async function resolveAttributeExpr(regl, expr, attrShaderName, plot) {
  if (Array.isArray(expr) && expr.length > 0 && expr[0] instanceof Float32Array) {
    return { kind: 'buffer-tiled', values: expr }
  }

  if (expr instanceof Float32Array) {
    return { kind: 'buffer', value: expr }
  }

  const data = plot ? plot.currentData : null
  const col = (expr instanceof ColumnData)
    ? expr
    : await resolveExprToColumn(expr, data, regl, plot)

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
