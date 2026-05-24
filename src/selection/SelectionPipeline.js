import { LassoMask } from "./LassoMask.js"

export class SelectionPipeline {
  constructor(regl, plot) {
    this._regl = regl
    this._plot = plot
    this._mask = new LassoMask(regl, plot.width, plot.height)
  }

  async runLasso(vertices, selectionColumns) {
    const plot = this._plot
    this._mask.update(vertices, plot.height)

    for (const node of plot._dataTransformNodes) await node.refreshIfNeeded(plot)
    for (const layer of plot.layers)
      for (const col of layer._dataColumns ?? []) await col.refresh(plot)

    for (const col of selectionColumns.values()) col.clear()
  }

  resize(w, h) { this._mask.resize(w, h) }
  destroy()    { this._mask.destroy() }
}
