import reglInit from "regl"
import { FilterAxisRegistry } from "../axes/FilterAxisRegistry.js"
import { Axis } from "../axes/Axis.js"
import { DataGroup, ComputedDataNode } from "../data/Data.js"
import { getComputedData } from "../compute/ComputationRegistry.js"

export class GlBase {
  constructor() {
    this.regl = null
    this.currentData = null
    this._rawData = null
    this._dataTransformNodes = []
    this.filterAxisRegistry = null
    this._axisCache = new Map()
    this._axesProxy = null
    this._initEpoch = 0
  }

  _initRegl(canvas) {
    const gl = canvas.getContext('webgl2', { desynchronized: true })
    if (!gl) throw new Error('WebGL 2.0 is required but not supported')

    const origGetExtension = gl.getExtension.bind(gl)
    gl.getExtension = (name) => {
      const lname = name.toLowerCase()
      const wgl2CoreExts = ['oes_texture_float', 'oes_texture_float_linear']
      if (wgl2CoreExts.includes(lname)) return origGetExtension(name) ?? {}
      if (lname === 'angle_instanced_arrays') {
        return origGetExtension(name) ?? {
          vertexAttribDivisorANGLE: gl.vertexAttribDivisor.bind(gl),
          drawArraysInstancedANGLE: gl.drawArraysInstanced.bind(gl),
          drawElementsInstancedANGLE: gl.drawElementsInstanced.bind(gl),
          VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88FE
        }
      }
      return origGetExtension(name)
    }

    const GL_RGBA = 0x1908, GL_FLOAT = 0x1406, GL_RGBA32F = 0x8814
    const origTexImage2D = gl.texImage2D.bind(gl)
    gl.texImage2D = function (...args) {
      if (args.length >= 8 && args[2] === GL_RGBA && args[7] === GL_FLOAT) {
        args = [...args]
        args[2] = GL_RGBA32F
      }
      return origTexImage2D(...args)
    }

    this.regl = reglInit({
      gl,
      extensions: ['OES_texture_float', 'EXT_color_buffer_float', 'ANGLE_instanced_arrays'],
      optionalExtensions: ['OES_texture_float_linear'],
    })
  }

  /**
   * Returns a stable Axis instance for the given axis name, creating one on first access.
   * The same instance is returned across update() calls so links survive updates.
   *
   * Usage: plot.axes.xaxis_bottom, pipeline.axes["velocity_ms"], etc.
   */
  get axes() {
    if (!this._axesProxy) {
      this._axesProxy = new Proxy(this._axisCache, {
        get: (cache, name) => {
          if (typeof name !== 'string') return undefined
          if (!cache.has(name)) cache.set(name, new Axis(this, name))
          return cache.get(name)
        }
      })
    }
    return this._axesProxy
  }

  _getAxis(name) {
    if (!this._axisCache.has(name)) this._axisCache.set(name, new Axis(this, name))
    return this._axisCache.get(name)
  }

  // For filter axes the axis ID is the quantity kind. Overridden by Plot for spatial axes.
  getAxisQuantityKind(axisId) {
    return axisId
  }

  // Default: filter axes only. Overridden by Plot to add spatial + color axes.
  getAxisDomain(axisId) {
    const filterRange = this.filterAxisRegistry?.getRange(axisId)
    if (filterRange) return [filterRange.min, filterRange.max]
    return null
  }

  // Default: filter axes only. Overridden by Plot to add spatial + color axes.
  setAxisDomain(axisId, domain) {
    if (this.filterAxisRegistry?.hasAxis(axisId)) {
      this.filterAxisRegistry.setRange(axisId, domain[0], domain[1])
    }
  }

  // No-op in base class. Overridden by Plot to schedule a WebGL render frame.
  scheduleRender() {}

  async _processTransforms(transforms, epoch) {
    if (!transforms || transforms.length === 0) return

    const TDR_STEP_MS = 500
    for (const { name, transform: spec } of transforms) {
      const entries = Object.entries(spec)
      if (entries.length !== 1) throw new Error(`Transform '${name}' must have exactly one key`)
      const [className, params] = entries[0]

      const computedData = getComputedData(className)
      if (!computedData) throw new Error(`Unknown computed data type: '${className}'`)

      const filterAxes = computedData.filterAxes(params, this.currentData)
      for (const quantityKind of Object.values(filterAxes)) {
        this.filterAxisRegistry.ensureFilterAxis(quantityKind)
      }

      const node = new ComputedDataNode(computedData, params)
      const stepStart = performance.now()
      try {
        await node._initialize(this.regl, this.currentData, this)
      } catch (e) {
        throw new Error(`Transform '${name}' (${className}) failed to initialize: ${e.message}`, { cause: e })
      }
      if (performance.now() - stepStart > TDR_STEP_MS)
        await new Promise(r => requestAnimationFrame(r))
      if (this._initEpoch !== epoch) return

      const filterDataExtents = node._meta?.filterDataExtents ?? {}
      for (const [qk, extent] of Object.entries(filterDataExtents)) {
        if (this.filterAxisRegistry.hasAxis(qk)) {
          this.filterAxisRegistry.setDataExtent(qk, extent[0], extent[1])
        }
      }

      this.currentData._children[name] = node
      this._dataTransformNodes.push(node)
    }
  }
}
