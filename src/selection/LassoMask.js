export class LassoMask {
  constructor(regl, width, height) {
    this._regl = regl
    this._fbo = regl.framebuffer({
      width,
      height,
      colorFormat: 'rgba',
      colorType: 'float',
      depth: false,
    })
    this._drawCmd = regl({
      vert: `#version 300 es
in vec2 a_pos;
uniform vec2 u_size;
void main() {
  gl_Position = vec4(a_pos / u_size * 2.0 - 1.0, 0.0, 1.0);
}`,
      frag: `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`,
      attributes: { a_pos: regl.prop('verts') },
      uniforms:   { u_size: regl.prop('size') },
      framebuffer: regl.prop('fbo'),
      primitive: 'triangles',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: false },
    })
  }

  // vertices: [[x, y], ...] in screen pixels (top-left origin, HTML coords)
  update(vertices, canvasHeight) {
    this._regl({ framebuffer: this._fbo })(() => {
      this._regl.clear({ color: [0, 0, 0, 0] })
    })
    if (vertices.length < 3) return

    // Fan triangulation from centroid
    const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length
    const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length
    const glY = y => canvasHeight - y   // flip HTML coords to GL coords

    const verts = []
    for (let i = 0; i < vertices.length; i++) {
      const [ax, ay] = vertices[i]
      const [bx, by] = vertices[(i + 1) % vertices.length]
      verts.push(cx, glY(cy), ax, glY(ay), bx, glY(by))
    }

    this._drawCmd({
      verts: new Float32Array(verts),
      size: [this._fbo.width, this._fbo.height],
      fbo: this._fbo,
      count: verts.length / 2,
    })
  }

  get fbo() { return this._fbo }

  resize(width, height) { this._fbo.resize(width, height) }
  destroy()              { this._fbo.destroy() }
}
