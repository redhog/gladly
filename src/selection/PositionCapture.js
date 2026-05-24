export class PositionCapture {
  constructor(regl) { this._regl = regl }

  // Returns a regl framebuffer: texel i = (ndcX, ndcY, pickId, endPoint)
  // Caller is responsible for calling .destroy() after use.
  run(captureDrawCmd, layerProps, n, endPoint = 0) {
    const w = Math.ceil(Math.sqrt(n))
    const h = Math.ceil(n / w)
    const fbo = this._regl.framebuffer({
      width: w, height: h,
      colorFormat: 'rgba', colorType: 'float', depth: false
    })
    this._regl({ framebuffer: fbo })(() => this._regl.clear({ color: [0, 0, 0, 0] }))
    captureDrawCmd({
      ...layerProps,
      u_mode:             1.0,
      u_capture_tex_size: [w, h],
      u_capture_endpoint: endPoint,
    })
    return fbo
  }
}
