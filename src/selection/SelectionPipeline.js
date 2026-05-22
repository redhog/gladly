import { PickCountFbo } from "./PickCountFbo.js"
import { GatherPass } from "./GatherPass.js"
import { LassoMask } from "./LassoMask.js"

export class SelectionPipeline {
  constructor(regl, plot) {
    this._regl = regl
    this._plot = plot
    this._pickCount = new PickCountFbo(regl, plot.width, plot.height)
    this._gather    = new GatherPass(regl, plot.width, plot.height)
    this._mask      = new LassoMask(regl, plot.width, plot.height)
  }

  // Main entry point: call on mouseup with accumulated polygon vertices.
  // vertices: [[x, y], ...] in HTML (top-left origin) canvas coords
  // selectionColumns: Map<layerIdx, SelectionColumn> — one per relevant layer
  async runLasso(vertices, selectionColumns) {
    const plot = this._plot

    // 1. Rasterize lasso polygon into mask FBO
    this._mask.update(vertices, plot.height)

    // 2. Refresh data (same as pick/render)
    for (const node of plot._dataTransformNodes) await node.refreshIfNeeded(plot)
    for (const layer of plot.layers) {
      for (const col of layer._dataColumns ?? []) await col.refresh(plot)
    }

    // 3. Clear all selection textures
    for (const col of selectionColumns.values()) col.clear()

    // 4. Halving loop per layer
    for (const [layerIdx, selCol] of selectionColumns) {
      const layer = plot.layers[layerIdx]
      const N = layer.instanceCount ?? layer.vertexCount ?? 0
      if (N > 0) await this._resolveLayer(layer, layerIdx, selCol, N)
    }
  }

  async _resolveLayer(layer, layerIdx, selCol, N) {
    const MAX_HALVINGS = Math.ceil(Math.log2(N)) + 1
    await this._halvingStep(layer, layerIdx, selCol, 0, N, 0, MAX_HALVINGS)
  }

  async _halvingStep(layer, layerIdx, selCol, lo, hi, depth, maxDepth) {
    if (lo >= hi || depth > maxDepth) return

    const buildProps = (l, idx, opts) => this._plot._buildLayerProps(l, idx, opts)

    // Render items [lo, hi) into pick + count FBOs
    this._pickCount.renderRange(this._plot, layer, layerIdx, buildProps, lo, hi)

    // Gather: write single-covered lasso pixels into selection texture
    this._gather.run(
      this._pickCount.pickFbo,
      this._pickCount.countFbo,
      this._mask.fbo,
      selCol,
      layerIdx,
      lo, hi
    )

    if (hi - lo <= 1) return  // fully resolved — single item

    const mid = Math.floor((lo + hi) / 2)
    await this._halvingStep(layer, layerIdx, selCol, lo,  mid, depth + 1, maxDepth)
    await this._halvingStep(layer, layerIdx, selCol, mid, hi,  depth + 1, maxDepth)
  }

  resize(w, h) {
    this._pickCount.resize(w, h)
    this._gather.resize(w, h)
    this._mask.resize(w, h)
  }

  destroy() {
    this._pickCount.destroy()
    this._gather.destroy()
    this._mask.destroy()
  }
}
