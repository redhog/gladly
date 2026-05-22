const GATHER_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 a_pixel;
uniform sampler2D u_pickTex;
uniform sampler2D u_countTex;
uniform sampler2D u_maskTex;
uniform vec2 u_screenSize;
uniform vec2 u_selTexSize;
uniform float u_idLo;
uniform float u_idHi;
uniform float u_layerIdx;
out float v_channel;

void main() {
  gl_PointSize = 1.0;
  vec2 uv = (a_pixel + 0.5) / u_screenSize;

  float mask  = texture(u_maskTex,  uv).r;
  float count = texture(u_countTex, uv).r;

  if (mask < 0.5 || count > 1.5 / 255.0) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 pick = texture(u_pickTex, uv);
  float layerEnc = pick.r * 255.0;
  if (abs(layerEnc - u_layerIdx) > 0.5) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);
    return;
  }

  float g = pick.g * 255.0;
  float b = pick.b * 255.0;
  float a = pick.a * 255.0;
  float pickId = g * 65536.0 + b * 256.0 + a;

  if (pickId < u_idLo || pickId >= u_idHi) {
    gl_Position = vec4(10.0, 0.0, 0.0, 1.0);
    return;
  }

  float texelIdx = floor(pickId / 4.0);
  float tx = mod(texelIdx, u_selTexSize.x);
  float ty = floor(texelIdx / u_selTexSize.x);
  gl_Position = vec4(
    (tx + 0.5) / u_selTexSize.x * 2.0 - 1.0,
    (ty + 0.5) / u_selTexSize.y * 2.0 - 1.0,
    0.0, 1.0
  );

  v_channel = mod(pickId, 4.0);
}`

const GATHER_FRAG = `#version 300 es
precision highp float;
in float v_channel;
out vec4 fragColor;
void main() {
  fragColor = vec4(
    v_channel < 0.5                          ? 1.0 : 0.0,
    v_channel >= 0.5 && v_channel < 1.5      ? 1.0 : 0.0,
    v_channel >= 1.5 && v_channel < 2.5      ? 1.0 : 0.0,
    v_channel >= 2.5                         ? 1.0 : 0.0
  );
}`

export class GatherPass {
  constructor(regl, canvasW, canvasH) {
    this._regl = regl
    this._pixelBuf = this._buildBuffer(regl, canvasW, canvasH)
    this._pixelCount = canvasW * canvasH
    this._cmd = regl({
      vert: GATHER_VERT,
      frag: GATHER_FRAG,
      attributes: { a_pixel: { buffer: regl.prop('pixelBuf'), size: 2 } },
      uniforms: {
        u_pickTex:    regl.prop('pickTex'),
        u_countTex:   regl.prop('countTex'),
        u_maskTex:    regl.prop('maskTex'),
        u_screenSize: regl.prop('screenSize'),
        u_selTexSize: regl.prop('selTexSize'),
        u_idLo:       regl.prop('idLo'),
        u_idHi:       regl.prop('idHi'),
        u_layerIdx:   regl.prop('layerIdx'),
      },
      framebuffer: regl.prop('selFbo'),
      primitive: 'points',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: true, func: { src: 'one', dst: 'one' } },
    })
  }

  _buildBuffer(regl, w, h) {
    const verts = new Float32Array(w * h * 2)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        verts[(y * w + x) * 2 + 0] = x
        verts[(y * w + x) * 2 + 1] = y
      }
    }
    return regl.buffer(verts)
  }

  // selectionColumn: SelectionColumn
  // layerIdx: 1-based layer index as encoded in pick FBO
  run(pickFbo, countFbo, maskFbo, selectionColumn, layerIdx, lo, hi) {
    this._cmd({
      pickTex:    pickFbo.color[0],
      countTex:   countFbo.color[0],
      maskTex:    maskFbo.color[0],
      screenSize: [pickFbo.width, pickFbo.height],
      selTexSize: [selectionColumn.texW, selectionColumn.texH],
      selFbo:     selectionColumn.fbo,
      idLo: lo,
      idHi: hi,
      layerIdx:   layerIdx + 1,  // 1-based encoding matches pick FBO
      pixelBuf:   this._pixelBuf,
      count:      this._pixelCount,
    })
  }

  resize(w, h) {
    this._pixelBuf.destroy()
    this._pixelBuf = this._buildBuffer(this._regl, w, h)
    this._pixelCount = w * h
  }

  destroy() {
    this._pixelBuf.destroy()
  }
}
