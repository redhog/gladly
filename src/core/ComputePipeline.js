import { GlBase } from "./GlBase.js"
import { AxisRegistry } from "../axes/AxisRegistry.js"
import { DataGroup, normalizeData } from "../data/Data.js"
import { ColumnData, ArrayColumn } from "../data/ColumnData.js"
import { tdrYield } from "../tdr.js"

// Read a 4-packed RGBA float texture back to a flat Float32Array of length dataLength.
async function readTextureToArray(regl, texture) {
  const dataLength = texture._dataLength ?? (texture.width * texture.height * 4)
  const fbo = regl.framebuffer({ color: texture, depth: false })
  let pixels
  try {
    regl({ framebuffer: fbo })(() => {
      pixels = regl.read()
    })
  } finally {
    fbo.destroy()
  }
  await tdrYield()
  const arr = pixels instanceof Float32Array ? pixels : new Float32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4)
  return arr.slice(0, dataLength)
}

// Wraps any ColumnData and adds getArray() for CPU readback.
class ReadableColumn extends ColumnData {
  constructor(col, regl) {
    super()
    this._col = col
    this._regl = regl
  }

  get length()       { return this._col.length }
  get domain()       { return this._col.domain }
  get quantityKind() { return this._col.quantityKind }

  resolve(path, regl) { return this._col.resolve(path, regl) }
  async toTexture(regl)     { return this._col.toTexture(regl) }
  refresh(plot)       { return this._col.refresh(plot) }
  withOffset(expr)    { return this._col.withOffset(expr) }

  async getArray() {
    if (this._col instanceof ArrayColumn) return this._col.array
    const tex = (await this._col.toTexture(this._regl))[0]
    return readTextureToArray(this._regl, tex)
  }
}

// Output object returned by ComputePipeline.update().
// Like DataGroup but getData() returns ReadableColumn with getArray(),
// and getArrays() reads all columns to CPU at once.
export class ComputeOutput {
  constructor(dataGroup, regl) {
    this._dataGroup = dataGroup
    this._regl = regl
  }

  columns() {
    return this._dataGroup.columns()
  }

  getData(col) {
    const colData = this._dataGroup.getData(col)
    if (!colData) return null
    return new ReadableColumn(colData, this._regl)
  }

  getArrays() {
    const result = {}
    for (const col of this.columns()) {
      const readable = this.getData(col)
      if (readable) {
        try {
          result[col] = readable.getArray()
        } catch (e) {
          console.warn(`[gladly] ComputeOutput.getArrays(): failed to read column '${col}': ${e.message}`)
        }
      }
    }
    return result
  }
}

// Headless GPU compute pipeline for running data transforms without any visual output.
// Creates its own offscreen WebGL context; no DOM container needed.
//
// Usage:
//   const pipeline = new ComputePipeline()
//   const output = pipeline.update({ data, transforms, axes })
//   const arr = output.getData('hist.counts').getArray()   // Float32Array
//   const all = output.getArrays()                         // { 'hist.counts': Float32Array, ... }
//   pipeline.destroy()
export class ComputePipeline extends GlBase {
  constructor() {
    super()
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas')
    this._initRegl(canvas)
    this.axisRegistry = new AxisRegistry()
  }

  // Runs the given transforms over data and returns a ComputeOutput.
  //
  // axes: { [quantityKind]: { min, max } } — sets filter axis ranges before computing.
  // Transforms that access a filter axis will see the configured range.
  async update({ data, transforms = [], axes = {} } = {}) {
    const epoch = ++this._initEpoch

    if (data !== undefined) {
      this._rawData = normalizeData(data)
    }

    this._dataTransformNodes = []
    this.axisRegistry = new AxisRegistry()

    if (this._rawData != null) {
      const fresh = new DataGroup({})
      fresh._children = { ...this._rawData._children }
      this.currentData = fresh
    } else {
      this.currentData = new DataGroup({})
    }

    // Run transforms; filter axes are registered and data extents set during this step.
    // At this point filter ranges are all null (open bounds).
    await this._processTransforms(transforms, epoch)
    if (this._initEpoch !== epoch) return new ComputeOutput(this.currentData, this.regl)

    // Apply axes config to set filter ranges on any registered filter axis.
    for (const [axisId, axisConfig] of Object.entries(axes)) {
      if (this.axisRegistry.hasFilterAxis(axisId)) {
        this.axisRegistry.setFilterBounds(
          axisId,
          axisConfig.min !== undefined ? axisConfig.min : null,
          axisConfig.max !== undefined ? axisConfig.max : null
        )
      }
    }

    // Refresh transforms whose output depends on any filter axis that now has a range set.
    for (const node of this._dataTransformNodes) {
      await node.refreshIfNeeded(this)
      if (this._initEpoch !== epoch) return new ComputeOutput(this.currentData, this.regl)
    }

    return new ComputeOutput(this.currentData, this.regl)
  }

  destroy() {
    if (this.regl) {
      this.regl.destroy()
      this.regl = null
    }
  }
}
