export class PickCountFbo {
  constructor(regl, width, height) {
    this._regl = regl

    // Pick FBO: uint8 rgba with depth (topmost item per pixel)
    this._pickTex  = regl.texture({ width, height, format: 'rgba', type: 'uint8' })
    this._pickFbo  = regl.framebuffer({ color: this._pickTex, depth: true })

    // Count FBO: float rgba, additive-blended, no depth test
    this._countTex = regl.texture({ width, height, format: 'rgba', type: 'float' })
    this._countFbo = regl.framebuffer({ color: this._countTex, depth: false })
  }

  // Renders all layers into both FBOs.
  // buildProps(layer, layerIdx, opts) → regl props object
  renderAll(plot, layers, buildProps) {
    this._regl({ framebuffer: this._pickFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0], depth: 1 })
      for (let i = 0; i < layers.length; i++) {
        layers[i].draw(buildProps(layers[i], i, { pickMode: 1.0 }))
      }
    })

    this._regl({ framebuffer: this._countFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].drawCount) {
          layers[i].drawCount(buildProps(layers[i], i, { pickMode: 0.0 }))
        }
      }
    })
  }

  // Renders only items with pickId in [lo, hi) for a specific layer.
  renderRange(plot, layer, layerIdx, buildProps, lo, hi) {
    this._regl({ framebuffer: this._pickFbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0], depth: 1 })
      layer.draw(buildProps(layer, layerIdx, { pickMode: 1.0, idLo: lo, idHi: hi }))
    })
    if (layer.drawCount) {
      this._regl({ framebuffer: this._countFbo })(() => {
        this._regl.clear({ color: [0, 0, 0, 0] })
        layer.drawCount(buildProps(layer, layerIdx, { pickMode: 0.0, idLo: lo, idHi: hi }))
      })
    }
  }

  get pickFbo()  { return this._pickFbo }
  get countFbo() { return this._countFbo }

  resize(w, h) {
    this._pickFbo.resize(w, h)
    this._countFbo.resize(w, h)
  }

  destroy() {
    this._pickFbo.destroy()
    this._countFbo.destroy()
  }
}
