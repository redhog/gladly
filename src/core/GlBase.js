import { initRegl } from "./initRegl.js"
import { AxisRegistry } from "../axes/AxisRegistry.js"
import { Axis } from "../axes/Axis.js"
import { Selection } from "../selection/Selection.js"
import { DataGroup, ComputedDataNode } from "../data/Data.js"
import { getComputedData } from "../compute/ComputationRegistry.js"

export class GlBase {
  constructor() {
    this.regl = null
    this.currentData = null
    this._rawData = null
    this._dataTransformNodes = []
    this.axisRegistry = null
    this._axisCache = new Map()
    this._axesProxy = null
    this._selectionCache = new Map()
    this._selectionsProxy = null
    this._initEpoch = 0
  }

  _initRegl(canvas) {
    this.regl = initRegl(canvas)
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

  /**
   * Returns a stable Selection instance for the given name, creating one on first access.
   * The same instance is returned across update() calls so subscriptions survive updates.
   *
   * Usage: plot.selections['brush1']
   */
  get selections() {
    if (!this._selectionsProxy) {
      this._selectionsProxy = new Proxy(this._selectionCache, {
        get: (cache, name) => {
          if (typeof name !== 'string') return undefined
          if (!cache.has(name)) cache.set(name, new Selection(this, name))
          return cache.get(name)
        }
      })
    }
    return this._selectionsProxy
  }

  _getSelection(name) {
    if (!this._selectionCache.has(name)) this._selectionCache.set(name, new Selection(this, name))
    return this._selectionCache.get(name)
  }

  // For filter axes the axis ID is the quantity kind. Overridden by Plot for spatial axes.
  getAxisQuantityKind(axisId) {
    return axisId
  }

  // Default: filter axes only. Overridden by Plot to add spatial + color axes.
  // Returns [min|null, max|null] for filter axes so transforms see open bounds as null.
  getAxisDomain(axisId) {
    if (this.axisRegistry?.hasFilterAxis(axisId)) {
      const bounds = this.axisRegistry.getFilterBounds(axisId)
      if (bounds !== null) return [bounds.min, bounds.max]
    }
    return this.axisRegistry?.getDomain(axisId) ?? null
  }

  // Default: filter axes only. Overridden by Plot to add spatial + color axes.
  setAxisDomain(axisId, domain) {
    if (this.axisRegistry?.hasFilterAxis(axisId)) {
      this.axisRegistry.setFilterBounds(axisId, domain[0], domain[1])
    }
  }

  // No-op in base class. Overridden by Plot to schedule a WebGL render frame.
  scheduleRender() {}

  // Re-throws by default. Overridden by Plot to log + dispatch to error listeners.
  _emitError(error) {
    throw error
  }

  async _processTransforms(transforms, epoch) {
    if (!transforms || transforms.length === 0) return

    const TDR_STEP_MS = 500
    for (const { name, transform: spec } of transforms) {
      const entries = Object.entries(spec)
      if (entries.length !== 1) {
        this._emitError(new Error(`Transform '${name}' must have exactly one key`))
        continue
      }
      const [className, params] = entries[0]

      const computedData = getComputedData(className)
      if (!computedData) {
        this._emitError(new Error(`Unknown computed data type: '${className}'`))
        continue
      }

      const filterAxes = computedData.filterAxes(params, this.currentData)
      for (const quantityKind of Object.values(filterAxes)) {
        this.axisRegistry.ensureFilterAxis(quantityKind)
      }

      const node = new ComputedDataNode(computedData, params)
      const stepStart = performance.now()
      try {
        await node._initialize(this.regl, this.currentData, this)
      } catch (e) {
        this._emitError(new Error(`Transform '${name}' (${className}) failed to initialize: ${e.message}`, { cause: e }))
        continue
      }
      if (performance.now() - stepStart > TDR_STEP_MS)
        await new Promise(r => requestAnimationFrame(r))
      if (this._initEpoch !== epoch) return

      const filterDataExtents = node._meta?.filterDataExtents ?? {}
      for (const [qk, extent] of Object.entries(filterDataExtents)) {
        if (this.axisRegistry.hasFilterAxis(qk)) {
          this.axisRegistry.setDataExtent(qk, extent[0], extent[1])
        }
      }

      this.currentData._children[name] = node
      this._dataTransformNodes.push(node)
    }
  }
}
