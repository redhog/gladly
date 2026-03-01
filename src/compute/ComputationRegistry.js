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

function domainsEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

// Resolve expr to a raw JS value (Float32Array / texture / number).
// Used for texture computation params — GLSL expressions are not permitted here.
function resolveToRawValue(regl, expr, path, getAxisDomain) {
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
        const resolvedParams = resolveToRawValue(regl, params, path, getAxisDomain)
        return comp.fn(regl, resolvedParams, getAxisDomain)
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
      resolved[k] = resolveToRawValue(regl, v, `${path}_${k}`, getAxisDomain)
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
        const uniformName = `u_cgen_${path}`
        const widthName = `u_cgen_${path}_width`

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
        const initGetter = makeTrackingGetter(liveRef, plot)
        const resolvedParams = resolveToRawValue(regl, params, path, initGetter)
        liveRef.texture = comp.fn(regl, resolvedParams, initGetter)

        // Cache the domains accessed during initial computation.
        for (const axisId of liveRef.accessedAxes) {
          liveRef.cachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
        }

        // Use a function so regl reads the current texture each frame.
        context.textureUniforms[uniformName] = () => liveRef.texture
        // Texture width is constant across recomputes (same bins count).
        context.scalarUniforms[widthName] = liveRef.texture.width
        context.globalDecls.push(`uniform sampler2D ${uniformName};`)
        context.globalDecls.push(`uniform float ${widthName};`)

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
            const newGetter = makeTrackingGetter(newRef, currentPlot)
            const newParams = resolveToRawValue(regl, params, path, newGetter)
            newRef.texture = comp.fn(regl, newParams, newGetter)
            for (const axisId of newRef.accessedAxes) {
              newRef.cachedDomains[axisId] = currentPlot.getAxisDomain(axisId)
            }

            // Update live ref in-place so the dynamic uniform picks up the new texture.
            liveRef.texture = newRef.texture
            liveRef.accessedAxes = newRef.accessedAxes
            liveRef.cachedDomains = newRef.cachedDomains
          }
        })

        return `texture2D(${uniformName}, vec2((a_pickId + 0.5) / ${widthName}, 0.5)).r`
      }

      if (glslComputations.has(compName)) {
        const comp = glslComputations.get(compName)
        const resolvedGlslParams = {}
        for (const [k, v] of Object.entries(params)) {
          resolvedGlslParams[k] = resolveToGlslExpr(regl, v, `${path}_${k}`, context, plot)
        }
        return comp.fn(resolvedGlslParams)
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
