export class LassoInteraction {
  constructor(plot, { selectionName, mode = 'lasso', trigger = 'shift' } = {}) {
    this._plot = plot
    this._selectionName = selectionName
    this._mode = mode
    this._trigger = trigger
    this._vertices = []
    this._active = false

    this._regl = null
    this._vertexBuf = null
    this._drawCmd = null

    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp   = this._onMouseUp.bind(this)

    this._renderCb = () => {
      if (this._vertices.length < 2) return
      this._ensureGl()
      if (!this._drawCmd) return
      this._vertexBuf(new Float32Array(this._vertices.flat()))
      this._drawCmd({ count: this._vertices.length, size: [plot.width, plot.height] })
    }
    plot._renderCallbacks.add(this._renderCb)

    plot.canvas.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
  }

  _ensureGl() {
    const regl = this._plot.regl
    if (!regl || this._regl === regl) return
    this._regl = regl
    this._vertexBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: 0 })
    this._drawCmd = regl({
      vert: `#version 300 es
in vec2 a_pos;
uniform vec2 u_size;
void main() {
  vec2 ndc = (a_pos / u_size) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`,
      frag: `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.47, 1.0, 1.0); }`,
      attributes: { a_pos: this._vertexBuf },
      uniforms: {
        u_size: regl.prop('size'),
      },
      primitive: 'line loop',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: false },
    })
  }

  _shouldActivate(e) {
    if (this._trigger === 'shift') return e.shiftKey
    if (this._trigger === 'ctrl')  return e.ctrlKey || e.metaKey
    return true
  }

  _canvasPos(e) {
    const r = this._plot.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  _onMouseDown(e) {
    if (!this._shouldActivate(e)) return
    e.preventDefault()
    this._active = true
    this._vertices = [this._canvasPos(e)]
  }

  _onMouseMove(e) {
    if (!this._active) return
    const [x, y] = this._canvasPos(e)
    const last = this._vertices[this._vertices.length - 1]
    const dx = x - last[0], dy = y - last[1]
    if (dx * dx + dy * dy > 25) {
      this._vertices.push([x, y])
      this._plot.scheduleRender()
    }
  }

  async _onMouseUp(e) {
    if (!this._active) return
    this._active = false
    const vertices = this._vertices
    this._vertices = []
    this._plot.scheduleRender()
    if (vertices.length >= 3) {
      await this._plot.selectLasso(vertices)
    }
  }

  destroy() {
    this._plot._renderCallbacks.delete(this._renderCb)
    if (this._vertexBuf) this._vertexBuf.destroy()
    this._plot.canvas.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
  }
}
