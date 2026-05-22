import { TextureColumn } from "../data/ColumnData.js"

export class SelectionColumn extends TextureColumn {
  constructor(regl, n) {
    const texW = Math.ceil(Math.sqrt(Math.ceil(n / 4)))
    const texH = Math.ceil(Math.ceil(n / 4) / texW)
    const tex = regl.texture({
      width: texW,
      height: texH,
      format: 'rgba',
      type: 'float',
      data: new Float32Array(texW * texH * 4),
    })
    super({ texture: tex }, { length: n })
    this._regl = regl
    this._n = n
    this._texW = texW
    this._texH = texH
    this._active = false
    this._fbo = regl.framebuffer({ color: tex, depth: false })
  }

  get fbo()    { return this._fbo }
  get texW()   { return this._texW }
  get texH()   { return this._texH }

  get active() { return this._active }

  clear() {
    this._regl({ framebuffer: this._fbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
    })
    this._active = false
  }

  activate() { this._active = true }

  destroy() {
    this._fbo.destroy()
  }
}
