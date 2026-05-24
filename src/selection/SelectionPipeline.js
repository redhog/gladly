import { PositionCapture }   from "./PositionCapture.js"
import { SelectionTestPass } from "./SelectionTestPass.js"
import { LassoMask }         from "./LassoMask.js"

export class SelectionPipeline {
  constructor(regl, plot) {
    this._regl    = regl
    this._plot    = plot
    this._capture = new PositionCapture(regl)
    this._test    = new SelectionTestPass(regl)
    this._mask    = new LassoMask(regl, plot.width, plot.height)
  }

  async runLasso(vertices, selectionColumns) {
    const plot = this._plot

    // Visual overlay
    this._mask.update(vertices, plot.height)

    // Convert lasso from HTML canvas coords (top-left origin, pixels) to NDC,
    // then upload as a float RGBA texture (width=N, height=1, RG = x,y).
    const w = plot.width, h = plot.height
    const lassoN   = vertices.length
    const lassoRaw = new Float32Array(lassoN * 4)
    for (let i = 0; i < lassoN; i++) {
      lassoRaw[i*4+0] =  vertices[i][0] / w * 2.0 - 1.0
      lassoRaw[i*4+1] = -(vertices[i][1] / h * 2.0 - 1.0)  // flip Y: HTML top-left → GL bottom-left
    }
    const lassoTex = this._regl.texture({
      width: lassoN, height: 1,
      format: 'rgba', type: 'float',
      data: lassoRaw,
    })

    // Refresh computed data columns
    for (const node of plot._dataTransformNodes) await node.refreshIfNeeded(plot)
    for (const layer of plot.layers)
      for (const col of layer._dataColumns ?? []) await col.refresh(plot)

    // Clear selection textures
    for (const col of selectionColumns.values()) col.clear()

    // Two-pass selection per layer
    for (const [layerIdx, selCol] of selectionColumns) {
      const layer = plot.layers[layerIdx]
      if (!layer.captureDrawCmd) continue

      const props = plot._buildLayerProps(layer, layerIdx, {})
      const N     = layer.instanceCount ?? layer.vertexCount ?? 0
      if (N === 0) continue

      if (layer.instanceCount != null) {
        // Instanced layer (e.g. LinesLayer): capture both endpoints separately
        const pos0 = this._capture.run(layer.captureDrawCmd, props, N, 0)
        const pos1 = this._capture.run(layer.captureDrawCmd, props, N, 1)
        this._test.runSegments(pos0, pos1, selCol, lassoTex, lassoN, N)
        pos0.destroy()
        pos1.destroy()
      } else {
        // Non-instanced layer (e.g. PointsLayer)
        const pos = this._capture.run(layer.captureDrawCmd, props, N, 0)
        this._test.runPoints(pos, selCol, lassoTex, lassoN, N)
        pos.destroy()
      }
    }

    lassoTex.destroy()
  }

  resize(w, h) { this._mask.resize(w, h) }
  destroy()    { this._mask.destroy() }
}
