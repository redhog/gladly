const textureComputations = new Map()
const glslComputations = new Map()

export function registerTextureComputation(name, fn) {
  textureComputations.set(name, { fn })
}

export function registerGlslComputation(name, fn) {
  glslComputations.set(name, { fn })
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

// Resolve expr to a raw JS value (Float32Array / texture / number).
// Used for texture computation params — GLSL expressions are not permitted here.
function resolveToRawValue(regl, expr, path) {
  if (expr instanceof Float32Array) return expr
  if (isTexture(expr)) return expr
  if (typeof expr === 'number') return expr

  if (typeof expr === 'object' && expr !== null) {
    const keys = Object.keys(expr)

    // Single-key object: check if it names a registered computation.
    if (keys.length === 1) {
      const compName = keys[0]
      if (textureComputations.has(compName)) {
        const comp = textureComputations.get(compName)
        const params = expr[compName]
        const resolvedParams = resolveToRawValue(regl, params, path)
        return comp.fn(regl, resolvedParams)
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
      resolved[k] = resolveToRawValue(regl, v, `${path}_${k}`)
    }
    return resolved
  }

  throw new Error(`Cannot resolve to raw value: ${JSON.stringify(expr)}`)
}

// Resolve expr to a GLSL expression string.
// Side effects: populates context.bufferAttrs, textureUniforms, scalarUniforms, globalDecls.
function resolveToGlslExpr(regl, expr, path, context) {
  if (expr instanceof Float32Array) {
    const attrName = `a_cgen_${path}`
    context.bufferAttrs[attrName] = expr
    context.globalDecls.push(`attribute float ${attrName};`)
    return attrName
  }

  if (isTexture(expr)) {
    const uniformName = `u_cgen_${path}`
    const widthName = `u_cgen_${path}_width`
    context.textureUniforms[uniformName] = expr
    context.scalarUniforms[widthName] = expr.width
    context.globalDecls.push(`uniform sampler2D ${uniformName};`)
    context.globalDecls.push(`uniform float ${widthName};`)
    return `texture2D(${uniformName}, vec2((a_pickId + 0.5) / ${widthName}, 0.5)).r`
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
        const resolvedParams = resolveToRawValue(regl, params, path)
        const texture = comp.fn(regl, resolvedParams)
        const uniformName = `u_cgen_${path}`
        const widthName = `u_cgen_${path}_width`
        context.textureUniforms[uniformName] = texture
        context.scalarUniforms[widthName] = texture.width
        context.globalDecls.push(`uniform sampler2D ${uniformName};`)
        context.globalDecls.push(`uniform float ${widthName};`)
        return `texture2D(${uniformName}, vec2((a_pickId + 0.5) / ${widthName}, 0.5)).r`
      }

      if (glslComputations.has(compName)) {
        const comp = glslComputations.get(compName)
        const resolvedGlslParams = {}
        for (const [k, v] of Object.entries(params)) {
          resolvedGlslParams[k] = resolveToGlslExpr(regl, v, `${path}_${k}`, context)
        }
        return comp.fn(resolvedGlslParams)
      }
    }
  }

  throw new Error(`Cannot resolve to GLSL expression: ${JSON.stringify(expr)}`)
}

// Top-level resolver: decides whether expr is a plain buffer or a computed attribute.
export function resolveAttributeExpr(regl, expr, attrShaderName) {
  if (expr instanceof Float32Array) {
    return { kind: 'buffer', value: expr }
  }

  const context = {
    bufferAttrs: {},
    textureUniforms: {},
    scalarUniforms: {},
    globalDecls: []
  }
  const glslExpr = resolveToGlslExpr(regl, expr, attrShaderName, context)
  return { kind: 'computed', glslExpr, context }
}
