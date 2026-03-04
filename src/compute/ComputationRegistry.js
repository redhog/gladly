import { Data } from '../core/Data.js'

const textureComputations = new Map()
const glslComputations = new Map()
const computedDataRegistry = new Map()

export class Computation {
  schema(data) { throw new Error('Not implemented') }
  getQuantityKind(params, data) { return null }
}

// Base class for GPU data transforms that produce multiple named output columns.
// Unlike TextureComputation (single texture), ComputedData produces { colName: texture, ..., _meta?: {...} }.
export class ComputedData {
  // Returns the list of output column names (known statically, no regl needed).
  columns() { throw new Error('Not implemented') }

  // Resolves a data parameter without regl. Accepts Float32Array, string column ref, or pass-through.
  resolveDataParam(data, value) {
    if (value instanceof Float32Array) return value
    if (typeof value === 'string') {
      if (!data) throw new Error(`Cannot resolve column '${value}': no data available`)
      return data.getData(value)
    }
    return value
  }

  // Returns { colName: reglTexture, ..., _meta?: { domains, quantityKinds, ... } }
  compute(regl, params, data, getAxisDomain) { throw new Error('Not implemented') }

  schema(data) { throw new Error('Not implemented') }
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

export function dataShape(regl, n) {
  const numTexels = Math.ceil(n / 4)
  const w = Math.min(numTexels, regl.limits.maxTextureSize)
  const h = Math.ceil(numTexels / w)
  return [w, h]
}

export class TextureComputation extends Computation {
  compute(regl, params, data, getAxisDomain) { throw new Error('Not implemented') }

  // Resolves a data parameter to a regl texture, folding into 2D if length exceeds maxTextureSize.
  // Accepts a Float32Array, an existing regl texture, or a string column name looked up from data.
  resolveDataParam(regl, data, value) {
    if (isTexture(value)) return value
    let array = value
    if (typeof value === 'string') {
      if (!data) throw new Error(`Cannot resolve column '${value}': no data available`)
      array = data.getData(value)
      if (!(array instanceof Float32Array)) throw new Error(`Column '${value}' not found in data`)
    }
    const [w, h] = dataShape(regl, array.length)
    const texData = new Float32Array(w * h * 4)
    texData.set(array)
    const tex = regl.texture({ data: texData, shape: [w, h], type: 'float', format: 'rgba' })
    tex._dataLength = array.length
    tex._packed = true
    return tex
  }
}

export class GlslComputation extends Computation {
  glsl(resolvedParams) { throw new Error('Not implemented') }
}

// Use in computation schema() methods for params that can be a Float32Array or sub-expression
export const EXPRESSION_REF = { '$ref': '#/$defs/expression' }

// Like EXPRESSION_REF but allows "none" as an explicit sentinel value (e.g. optional axes)
export const EXPRESSION_REF_OPT = { '$ref': '#/$defs/expression_opt' }

export function registerTextureComputation(name, computation) {
  textureComputations.set(name, computation)
}

export function registerGlslComputation(name, computation) {
  glslComputations.set(name, computation)
}

// Resolve the quantity kind of an expression (string column name or computed expression).
// For a string column name: returns data.getQuantityKind(expr) falling back to expr itself.
// For a computed expression { compName: params }: delegates to computation.getQuantityKind().
// Returns null when the quantity kind cannot be determined.
export function resolveQuantityKind(expr, data) {
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

// Schema for the transforms config block: { transformName: { ClassName: params } }
// data should already be wrapped as the DataGroup the transform will receive at runtime
// (e.g. new DataGroup({ input: rawData })) so that column enums show the correct paths.
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
      { type: 'string', const: 'none', enum: ['none'], title: 'none', readOnly: true }
    ].concat(defs.expression.anyOf)
  }

  return { '$defs': defs, '$ref': '#/$defs/expression' }
}

// Duck-type check for regl textures.
export function isTexture(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.width === 'number' &&
    typeof value.subimage === 'function'
  )
}

function domainsEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

// Resolve expr to a raw JS value (Float32Array / texture / number).
// Used for texture computation params — GLSL expressions are not permitted here.
function resolveToRawValue(regl, expr, path, data, getAxisDomain) {
  if (expr instanceof Float32Array) return expr
  if (isTexture(expr)) return expr
  if (typeof expr === 'number') return expr
  if (typeof expr === 'string') return expr

  if (typeof expr === 'object' && expr !== null) {
    const keys = Object.keys(expr)

    // Single-key object: check if it names a registered computation.
    if (keys.length === 1) {
      const compName = keys[0]
      if (textureComputations.has(compName)) {
        const comp = textureComputations.get(compName)
        const params = expr[compName]
        const resolvedParams = resolveToRawValue(regl, params, path, data, getAxisDomain)
        return comp.compute(regl, resolvedParams, data, getAxisDomain)
      }
      if (glslComputations.has(compName)) {
        throw new Error(
          `GLSL computation '${compName}' cannot be used as a texture computation parameter`
        )
      }
    }

    // Plain params dict: resolve each value recursively.
    const resolved = {}
    for (const [k, v] of Object.entries(expr)) {
      resolved[k] = resolveToRawValue(regl, v, `${path}_${k}`, data, getAxisDomain)
    }
    return resolved
  }

  throw new Error(`Cannot resolve to raw value: ${JSON.stringify(expr)}`)
}

// Resolve expr to a GLSL expression string.
// Side effects: populates context.bufferAttrs, textureUniforms, scalarUniforms, globalDecls, axisUpdaters.
function resolveToGlslExpr(regl, expr, path, context, plot) {
  if (expr instanceof Float32Array) {
    const attrName = `a_cgen_${path}`
    context.bufferAttrs[attrName] = expr
    context.globalDecls.push(`in float ${attrName};`)
    return attrName
  }

  // Live reference from a ComputedDataNode — checked BEFORE isTexture.
  // Uses a dynamic uniform function so the current texture is read each frame.
  if (expr && typeof expr === 'object' && expr._isLive) {
    const uniformName = `u_cgen_${path}`
    const widthName = `u_cgen_${path}_width`
    const heightName = `u_cgen_${path}_height`
    context.textureUniforms[uniformName] = () => expr.texture
    context.scalarUniforms[widthName] = expr.texture.width
    context.scalarUniforms[heightName] = expr.texture.height
    context.globalDecls.push(`uniform sampler2D ${uniformName};`)
    context.globalDecls.push(`uniform float ${widthName};`)
    context.globalDecls.push(`uniform float ${heightName};`)
    // Non-packed sampling: each bin i stores its value in the R channel at texel i.
    return `texture(${uniformName}, vec2((mod(a_pickId, ${widthName}) + 0.5) / ${widthName}, (floor(a_pickId / ${widthName}) + 0.5) / ${heightName})).r`
  }

  if (isTexture(expr)) {
    const uniformName = `u_cgen_${path}`
    const widthName = `u_cgen_${path}_width`
    const heightName = `u_cgen_${path}_height`
    context.textureUniforms[uniformName] = expr
    context.scalarUniforms[widthName] = expr.width
    context.scalarUniforms[heightName] = expr.height
    context.globalDecls.push(`uniform sampler2D ${uniformName};`)
    context.globalDecls.push(`uniform float ${widthName};`)
    context.globalDecls.push(`uniform float ${heightName};`)
    if (expr._packed) {
      const fnName = `_samplePacked_${path}`
      context.globalDecls.push(`float ${fnName}(float pickId) {
  float _tid = floor(pickId / 4.0);
  float _tx = mod(_tid, ${widthName}); float _ty = floor(_tid / ${widthName});
  vec4 _t = texture(${uniformName}, vec2((_tx + 0.5) / ${widthName}, (_ty + 0.5) / ${heightName}));
  float _ch = pickId - 4.0 * _tid;
  return mix(mix(_t.r, _t.g, clamp(_ch, 0.0, 1.0)), mix(_t.b, _t.a, clamp(_ch - 2.0, 0.0, 1.0)), step(1.5, _ch));
}`)
      return `${fnName}(a_pickId)`
    }
    return `texture(${uniformName}, vec2((mod(a_pickId, ${widthName}) + 0.5) / ${widthName}, (floor(a_pickId / ${widthName}) + 0.5) / ${heightName})).r`
  }

  if (typeof expr === 'number') {
    const uniformName = `u_cgen_${path}`
    context.scalarUniforms[uniformName] = expr
    context.globalDecls.push(`uniform float ${uniformName};`)
    return uniformName
  }

  if (typeof expr === 'object' && expr !== null) {
    const keys = Object.keys(expr)

    if (keys.length === 1) {
      const compName = keys[0]
      const params = expr[compName]

      if (textureComputations.has(compName)) {
        const comp = textureComputations.get(compName)
        const uniformName = `u_cgen_${path}`
        const widthName = `u_cgen_${path}_width`
        const heightName = `u_cgen_${path}_height`

        // Live reference updated when axis domains change.
        const liveRef = {
          texture: null,
          accessedAxes: new Set(),
          cachedDomains: {}
        }

        const makeTrackingGetter = (ref, currentPlot) => (axisId) => {
          ref.accessedAxes.add(axisId)
          return currentPlot ? currentPlot.getAxisDomain(axisId) : null
        }

        // Initial computation with axis tracking.
        const initData = plot ? Data.wrap(plot.currentData) : null
        const initGetter = makeTrackingGetter(liveRef, plot)
        const resolvedParams = resolveToRawValue(regl, params, path, initData, initGetter)
        liveRef.texture = comp.compute(regl, resolvedParams, initData, initGetter)

        // Cache the domains accessed during initial computation.
        for (const axisId of liveRef.accessedAxes) {
          liveRef.cachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
        }

        // Use a function so regl reads the current texture each frame.
        context.textureUniforms[uniformName] = () => liveRef.texture
        // Width and height are constant across recomputes (same data length).
        context.scalarUniforms[widthName] = liveRef.texture.width
        context.scalarUniforms[heightName] = liveRef.texture.height
        context.globalDecls.push(`uniform sampler2D ${uniformName};`)
        context.globalDecls.push(`uniform float ${widthName};`)
        context.globalDecls.push(`uniform float ${heightName};`)
        if (liveRef.texture._packed) {
          const fnName = `_samplePacked_${path}`
          context.globalDecls.push(`float ${fnName}(float pickId) {
  float _tid = floor(pickId / 4.0);
  float _tx = mod(_tid, ${widthName}); float _ty = floor(_tid / ${widthName});
  vec4 _t = texture(${uniformName}, vec2((_tx + 0.5) / ${widthName}, (_ty + 0.5) / ${heightName}));
  float _ch = pickId - 4.0 * _tid;
  return mix(mix(_t.r, _t.g, clamp(_ch, 0.0, 1.0)), mix(_t.b, _t.a, clamp(_ch - 2.0, 0.0, 1.0)), step(1.5, _ch));
}`)
        }

        context.axisUpdaters.push({
          refreshIfNeeded(currentPlot) {
            if (liveRef.accessedAxes.size === 0) return

            let needsRecompute = false
            for (const axisId of liveRef.accessedAxes) {
              if (!domainsEqual(currentPlot.getAxisDomain(axisId), liveRef.cachedDomains[axisId])) {
                needsRecompute = true
                break
              }
            }
            if (!needsRecompute) return

            // Recompute with fresh axis tracking so new dependencies are captured.
            const newRef = { accessedAxes: new Set(), cachedDomains: {} }
            const newData = currentPlot ? Data.wrap(currentPlot.currentData) : null
            const newGetter = makeTrackingGetter(newRef, currentPlot)
            const newParams = resolveToRawValue(regl, params, path, newData, newGetter)
            newRef.texture = comp.compute(regl, newParams, newData, newGetter)
            for (const axisId of newRef.accessedAxes) {
              newRef.cachedDomains[axisId] = currentPlot.getAxisDomain(axisId)
            }

            // Update live ref in-place so the dynamic uniform picks up the new texture.
            liveRef.texture = newRef.texture
            liveRef.accessedAxes = newRef.accessedAxes
            liveRef.cachedDomains = newRef.cachedDomains
          }
        })

        return liveRef.texture._packed
          ? `_samplePacked_${path}(a_pickId)`
          : `texture(${uniformName}, vec2((mod(a_pickId, ${widthName}) + 0.5) / ${widthName}, (floor(a_pickId / ${widthName}) + 0.5) / ${heightName})).r`
      }

      if (glslComputations.has(compName)) {
        const comp = glslComputations.get(compName)
        const resolvedGlslParams = {}
        for (const [k, v] of Object.entries(params)) {
          resolvedGlslParams[k] = resolveToGlslExpr(regl, v, `${path}_${k}`, context, plot)
        }
        return comp.glsl(resolvedGlslParams)
      }
    }
  }

  throw new Error(`Cannot resolve to GLSL expression: ${JSON.stringify(expr)}`)
}

// Top-level resolver: decides whether expr is a plain buffer or a computed attribute.
export function resolveAttributeExpr(regl, expr, attrShaderName, plot) {
  if (expr instanceof Float32Array) {
    return { kind: 'buffer', value: expr }
  }

  if (typeof expr === 'string') {
    const data = plot ? Data.wrap(plot.currentData) : null
    const val = data?.getData(expr)
    if (!val) throw new Error(`Column '${expr}' not found in data`)
    // Plain array → buffer attribute.
    if (val instanceof Float32Array) return { kind: 'buffer', value: val }
    // Live ref or texture → resolve as GLSL computed attribute.
    const context = {
      bufferAttrs: {},
      textureUniforms: {},
      scalarUniforms: {},
      globalDecls: [],
      axisUpdaters: []
    }
    const glslExpr = resolveToGlslExpr(regl, val, attrShaderName, context, plot)
    return { kind: 'computed', glslExpr, context }
  }

  const context = {
    bufferAttrs: {},
    textureUniforms: {},
    scalarUniforms: {},
    globalDecls: [],
    axisUpdaters: []
  }
  const glslExpr = resolveToGlslExpr(regl, expr, attrShaderName, context, plot)
  return { kind: 'computed', glslExpr, context }
}
