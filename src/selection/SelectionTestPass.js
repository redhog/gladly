// Lasso polygon is passed as a float RGBA texture (width=N, height=1).
// Texel i = (ndcX, ndcY, 0, 0) for lasso vertex i.
const LASSO_GLSL = `
uniform sampler2D u_lasso_tex;
uniform int  u_lasso_n;
uniform vec2 u_selTexSize;
out float v_channel;

float pointInLasso(vec2 p) {
  int winding = 0;
  for (int i = 0; i < u_lasso_n; i++) {
    int j = (i + 1 == u_lasso_n) ? 0 : i + 1;
    vec2 a = texelFetch(u_lasso_tex, ivec2(i, 0), 0).xy;
    vec2 b = texelFetch(u_lasso_tex, ivec2(j, 0), 0).xy;
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x) > 0.0) winding++;
    } else {
      if (b.y <= p.y && (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x) < 0.0) winding--;
    }
  }
  return float(winding != 0);
}

bool segmentsIntersect(vec2 p0, vec2 p1, vec2 q0, vec2 q1) {
  vec2 d = p1-p0, e = q1-q0;
  float denom = d.x*e.y - d.y*e.x;
  if (abs(denom) < 1e-10) return false;
  vec2 f = q0-p0;
  float t = (f.x*e.y - f.y*e.x) / denom;
  float u = (f.x*d.y - f.y*d.x) / denom;
  return t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0;
}

float segmentIntersectsLasso(vec2 p0, vec2 p1) {
  if (pointInLasso(p0) > 0.5 || pointInLasso(p1) > 0.5) return 1.0;
  for (int i = 0; i < u_lasso_n; i++) {
    int j = (i + 1 == u_lasso_n) ? 0 : i + 1;
    vec2 a = texelFetch(u_lasso_tex, ivec2(i, 0), 0).xy;
    vec2 b = texelFetch(u_lasso_tex, ivec2(j, 0), 0).xy;
    if (segmentsIntersect(p0, p1, a, b)) return 1.0;
  }
  return 0.0;
}

void scatterSelect(float pickId, float selected) {
  if (selected < 0.5) { gl_Position = vec4(10.0, 0.0, 0.0, 1.0); return; }
  float texelIdx = floor(pickId / 4.0);
  float tx = mod(texelIdx, u_selTexSize.x);
  float ty = floor(texelIdx / u_selTexSize.x);
  gl_Position = vec4(
    (tx + 0.5) / u_selTexSize.x * 2.0 - 1.0,
    (ty + 0.5) / u_selTexSize.y * 2.0 - 1.0,
    0.0, 1.0
  );
  v_channel = mod(pickId, 4.0);
  gl_PointSize = 1.0;
}
`

const POINT_SEL_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
in float a_inst_id;
uniform sampler2D u_pos_tex;
uniform float u_pos_tex_w;
${LASSO_GLSL}
void main() {
  ivec2 tc = ivec2(int(mod(a_inst_id, u_pos_tex_w)),
                   int(a_inst_id / u_pos_tex_w));
  vec4 d = texelFetch(u_pos_tex, tc, 0);
  scatterSelect(d.z, pointInLasso(d.xy));
}`

const SEGMENT_SEL_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
in float a_inst_id;
uniform sampler2D u_pos_tex;
uniform sampler2D u_pos1_tex;
uniform float u_pos_tex_w;
${LASSO_GLSL}
void main() {
  ivec2 tc = ivec2(int(mod(a_inst_id, u_pos_tex_w)),
                   int(a_inst_id / u_pos_tex_w));
  vec4 d0 = texelFetch(u_pos_tex,  tc, 0);
  vec4 d1 = texelFetch(u_pos1_tex, tc, 0);
  scatterSelect(d0.z, segmentIntersectsLasso(d0.xy, d1.xy));
}`

const SEL_FRAG = `#version 300 es
precision highp float;
in float v_channel;
out vec4 fragColor;
void main() {
  fragColor = vec4(
    v_channel < 0.5                     ? 1.0 : 0.0,
    v_channel >= 0.5 && v_channel < 1.5 ? 1.0 : 0.0,
    v_channel >= 1.5 && v_channel < 2.5 ? 1.0 : 0.0,
    v_channel >= 2.5                    ? 1.0 : 0.0
  );
}`

export class SelectionTestPass {
  constructor(regl) {
    this._regl         = regl
    this._pointCmd     = this._build(regl, POINT_SEL_VERT)
    this._segmentCmd   = this._build(regl, SEGMENT_SEL_VERT)
    this._instIdBuf    = null
    this._instIdBufLen = 0
  }

  _build(regl, vert) {
    return regl({
      vert, frag: SEL_FRAG,
      attributes: { a_inst_id: regl.prop('instIds') },
      uniforms: {
        u_pos_tex:   regl.prop('posTex'),
        u_pos1_tex:  regl.prop('pos1Tex'),
        u_pos_tex_w: regl.prop('posTexW'),
        u_selTexSize:regl.prop('selTexSize'),
        u_lasso_tex: regl.prop('lassoTex'),
        u_lasso_n:   regl.prop('lassoN'),
      },
      framebuffer: regl.prop('selFbo'),
      viewport:    regl.prop('viewport'),
      primitive: 'points',
      count: regl.prop('count'),
      depth: { enable: false },
      blend: { enable: true, func: { src: 'one', dst: 'one' } },
    })
  }

  _instanceIds(n) {
    if (this._instIdBufLen < n) {
      const arr = new Float32Array(n)
      for (let i = 0; i < n; i++) arr[i] = i
      if (this._instIdBuf) this._instIdBuf.destroy()
      this._instIdBuf    = this._regl.buffer(arr)
      this._instIdBufLen = n
    }
    return this._instIdBuf
  }

  // lassoTex: regl texture (width=N, height=1) with NDC coords in RG channels
  runPoints(posFbo, selectionColumn, lassoTex, lassoN, n) {
    this._pointCmd({
      instIds:    this._instanceIds(n),
      posTex:     posFbo.color[0],
      pos1Tex:    null,
      posTexW:    posFbo.width,
      selTexSize: [selectionColumn.texW, selectionColumn.texH],
      selFbo:     selectionColumn.fbo,
      viewport:   { x: 0, y: 0, width: selectionColumn.texW, height: selectionColumn.texH },
      lassoTex,
      lassoN,
      count:      n,
    })
  }

  runSegments(pos0Fbo, pos1Fbo, selectionColumn, lassoTex, lassoN, n) {
    this._segmentCmd({
      instIds:    this._instanceIds(n),
      posTex:     pos0Fbo.color[0],
      pos1Tex:    pos1Fbo.color[0],
      posTexW:    pos0Fbo.width,
      selTexSize: [selectionColumn.texW, selectionColumn.texH],
      selFbo:     selectionColumn.fbo,
      viewport:   { x: 0, y: 0, width: selectionColumn.texW, height: selectionColumn.texH },
      lassoTex,
      lassoN,
      count:      n,
    })
  }

  destroy() {
    if (this._instIdBuf) this._instIdBuf.destroy()
  }
}
