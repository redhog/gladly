class FboEntry {
  constructor(regl, width, height) {
    this.texture      = regl.texture({ width, height, format: 'rgba', type: 'float' })
    this.fbo          = regl.framebuffer({ color: this.texture, depth: false })
    this.writeVersion = 0
    this.producer     = null    // Plot that renders into this FBO
    this.consumers    = new Set() // Plots that sample this FBO as a texture
  }

  destroy() {
    this.fbo.destroy()
    this.texture.destroy()
  }
}

export class FramebufferRegistry {
  constructor() {
    this._fbos = new Map()  // name → FboEntry
  }

  ensure(name, regl, width, height) {
    if (!this._fbos.has(name)) {
      this._fbos.set(name, new FboEntry(regl, width, height))
    }
    return this._fbos.get(name)
  }

  get(name) {
    return this._fbos.get(name) ?? null
  }

  destroy() {
    for (const entry of this._fbos.values()) entry.destroy()
    this._fbos.clear()
  }
}
