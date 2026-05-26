import { PositionCapture }   from "./PositionCapture.js"
import { SelectionTestPass } from "./SelectionTestPass.js"
import { LassoMask }         from "./LassoMask.js"

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

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
    const h = plot.height
    const lassoN   = vertices.length
    const lassoRaw = new Float32Array(lassoN * 4)
    for (let i = 0; i < lassoN; i++) {
      lassoRaw[i*4+0] = (vertices[i][0] - plot.margin.left)        / plot.plotWidth  * 2.0 - 1.0
      lassoRaw[i*4+1] = (h - vertices[i][1] - plot.margin.bottom)  / plot.plotHeight * 2.0 - 1.0
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

    // Two-pass selection per layer, per tile.
    for (const [layerIdx, selCol] of selectionColumns) {
      const layer = plot.layers[layerIdx]
      if (!layer.captureDrawCmd) continue

      // Ensure selection tile structure matches current render tile layout.
      // layer._tileSizes is updated on every render; it may have changed since
      // the last render if new tiled data arrived over the network.
      const tileSizes = layer._tileSizes ?? [layer.instanceCount ?? layer.vertexCount ?? 0]
      if (tileSizes.every(n => n > 0) && !arraysEqual(selCol._tiles.map(t => t.n), tileSizes)) {
        selCol._rebuild(tileSizes)
      }

      const props = plot._buildLayerProps(layer, layerIdx, {})

      for (let t = 0; t < selCol._tiles.length; t++) {
        const tile = selCol._tiles[t]
        if (tile.n === 0) continue

        // _tileOnly: run only this tile's geometry.
        // _captureTileOffset: force u_tile_pick_offset=0 so vertices are written at local
        // pick IDs 0..tile.n-1, matching the per-tile selection texture's index space.
        const tileProps = { ...props, _tileOnly: t, _captureTileOffset: 0 }

        if (layer.instanceCount != null) {
          // Instanced layer (e.g. LinesLayer): capture both endpoints separately.
          const pos0 = this._capture.run(layer.captureDrawCmd, tileProps, tile.n, 0)
          const pos1 = this._capture.run(layer.captureDrawCmd, tileProps, tile.n, 1)
          this._test.runSegments(pos0, pos1, tile, lassoTex, lassoN, tile.n)
          pos0.destroy()
          pos1.destroy()
        } else {
          const pos = this._capture.run(layer.captureDrawCmd, tileProps, tile.n, 0)
          this._test.runPoints(pos, tile, lassoTex, lassoN, tile.n)
          pos.destroy()
        }
      }
    }

    lassoTex.destroy()
  }

  resize(w, h) { this._mask.resize(w, h) }
  destroy()    { this._mask.destroy() }
}
