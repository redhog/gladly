import { registerComputedData, EXPRESSION_REF } from "./ComputationRegistry.js"
import { ComputedData } from "../data/Computation.js"
import { ArrayColumn, uploadToTexture, SAMPLE_COLUMN_GLSL } from "../data/ColumnData.js"

function colDomain(col) {
  if (col instanceof ArrayColumn) {
    const arr = col.array
    let min = arr[0], max = arr[0]
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i]
      if (arr[i] > max) max = arr[i]
    }
    return [min, max]
  }
  return col.domain ?? [0, 1]
}

function makeSplatPass(regl, W, H, pickIds, xTex, yTex, valueTex, xDomain, yDomain, radius) {
  const accTex = regl.texture({ width: W, height: H, type: 'float', format: 'rgba' })
  const accFBO = regl.framebuffer({ color: accTex, depth: false, stencil: false })
  regl.clear({ color: [0, 0, 0, 0], framebuffer: accFBO })

  const N = pickIds.length
  const pointSize = radius * 2.0 + 1.0

  const drawSplat = regl({
    framebuffer: accFBO,
    blend: { enable: true, func: { src: 'one', dst: 'one' } },
    vert: `#version 300 es
precision highp float;
precision highp sampler2D;
in float a_pickId;
uniform sampler2D u_xTex, u_yTex, u_valueTex;
uniform float u_xMin, u_xMax, u_yMin, u_yMax;
${SAMPLE_COLUMN_GLSL}
out float v_value;
void main() {
  float xVal  = sampleColumn(u_xTex,     a_pickId);
  float yVal  = sampleColumn(u_yTex,     a_pickId);
  v_value     = sampleColumn(u_valueTex, a_pickId);
  float ndcX  = (xVal - u_xMin) / max(u_xMax - u_xMin, 1e-10) * 2.0 - 1.0;
  float ndcY  = (yVal - u_yMin) / max(u_yMax - u_yMin, 1e-10) * 2.0 - 1.0;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  gl_PointSize = ${pointSize.toFixed(2)};
}`,
    frag: `#version 300 es
precision highp float;
in float v_value;
out vec4 fragColor;
void main() {
  vec2  pc  = gl_PointCoord - 0.5;
  float d   = length(pc) * ${pointSize.toFixed(2)};
  if (d > ${radius.toFixed(2)}) discard;
  float w   = exp(-0.5 * (d / ${radius.toFixed(2)}) * (d / ${radius.toFixed(2)}));
  fragColor = vec4(v_value * w, 0.0, 0.0, w);
}`,
    attributes: { a_pickId: pickIds },
    uniforms: {
      u_xTex: xTex,
      u_yTex: yTex,
      u_valueTex: valueTex,
      u_xMin: xDomain[0], u_xMax: xDomain[1],
      u_yMin: yDomain[0], u_yMax: yDomain[1],
    },
    count: N,
    primitive: 'points'
  })

  drawSplat()
  return accTex
}

function makeValueTexture(regl, W, H, accum1, accum2, accum3, w1, w2, w3) {
  const totalN  = W * H
  const nTexels = Math.ceil(totalN / 4)
  const outW    = Math.min(nTexels, regl.limits.maxTextureSize)
  const outH    = Math.ceil(nTexels / outW)

  const outTex = regl.texture({ width: outW, height: outH, type: 'float', format: 'rgba' })
  const outFBO = regl.framebuffer({ color: outTex, depth: false, stencil: false })

  regl({
    framebuffer: outFBO,
    vert: `#version 300 es
precision highp float;
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`,
    frag: `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_accum1, u_accum2, u_accum3;
uniform float u_w1, u_w2, u_w3;
out vec4 fragColor;

float sampleInterp(sampler2D accum, int linearIdx) {
  if (linearIdx >= ${totalN}) return 0.0;
  int px = linearIdx % ${W};
  int py = linearIdx / ${W};
  vec4 a = texelFetch(accum, ivec2(px, py), 0);
  if (a.a < 1e-6) return 0.0;
  return a.r / a.a;
}

float combine(int idx) {
  return u_w1 * sampleInterp(u_accum1, idx)
       + u_w2 * sampleInterp(u_accum2, idx)
       + u_w3 * sampleInterp(u_accum3, idx);
}

void main() {
  int texelI = int(gl_FragCoord.y) * ${outW} + int(gl_FragCoord.x);
  int base   = texelI * 4;
  fragColor  = vec4(
    combine(base + 0),
    combine(base + 1),
    combine(base + 2),
    combine(base + 3)
  );
}`,
    attributes: { a_position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
    uniforms: {
      u_accum1: accum1,
      u_accum2: accum2,
      u_accum3: accum3,
      u_w1: w1, u_w2: w2, u_w3: w3,
    },
    count: 4,
    primitive: 'triangle strip'
  })()

  outTex._dataLength = totalN
  outTex._dataShape  = [W, H]
  return outTex
}

function makeCoordTexturesCorners(regl, xDomain, yDomain) {
  // Four corners in row-major [2,2] order: index = iy*2 + ix
  // (ix=0,iy=0)=xMin/yMin  (ix=1,iy=0)=xMax/yMin
  // (ix=0,iy=1)=xMin/yMax  (ix=1,iy=1)=xMax/yMax
  const xArr = new Float32Array([xDomain[0], xDomain[1], xDomain[0], xDomain[1]])
  const yArr = new Float32Array([yDomain[0], yDomain[0], yDomain[1], yDomain[1]])
  const xTex = uploadToTexture(regl, xArr)
  const yTex = uploadToTexture(regl, yArr)
  xTex._dataShape = [2, 2]
  yTex._dataShape = [2, 2]
  return { xTex, yTex }
}

function makeCoordTexturesFull(regl, W, H, xDomain, yDomain) {
  const totalN  = W * H
  const nTexels = Math.ceil(totalN / 4)
  const outW    = Math.min(nTexels, regl.limits.maxTextureSize)
  const outH    = Math.ceil(nTexels / outW)

  const makeCoordTex = (axis) => {
    const outTex = regl.texture({ width: outW, height: outH, type: 'float', format: 'rgba' })
    const outFBO = regl.framebuffer({ color: outTex, depth: false, stencil: false })

    regl({
      framebuffer: outFBO,
      vert: `#version 300 es
precision highp float;
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`,
      frag: `#version 300 es
precision highp float;
out vec4 fragColor;
float coordAt(int linearIdx) {
  if (linearIdx >= ${totalN}) return 0.0;
  int px = linearIdx % ${W};
  int py = linearIdx / ${W};
  ${axis === 'x'
    ? `return ${xDomain[0].toFixed(10)} + (float(px) + 0.5) / float(${W}) * float(${(xDomain[1] - xDomain[0]).toFixed(10)});`
    : `return ${yDomain[0].toFixed(10)} + (float(py) + 0.5) / float(${H}) * float(${(yDomain[1] - yDomain[0]).toFixed(10)});`
  }
}
void main() {
  int texelI = int(gl_FragCoord.y) * ${outW} + int(gl_FragCoord.x);
  int base   = texelI * 4;
  fragColor  = vec4(
    coordAt(base + 0),
    coordAt(base + 1),
    coordAt(base + 2),
    coordAt(base + 3)
  );
}`,
      attributes: { a_position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
      uniforms: {},
      count: 4,
      primitive: 'triangle strip'
    })()

    outTex._dataLength = totalN
    outTex._dataShape  = [W, H]
    return outTex
  }

  return { xTex: makeCoordTex('x'), yTex: makeCoordTex('y') }
}

class Scatter2dInterpolateData extends ComputedData {
  columns() { return ['value', 'x', 'y'] }

  compute(regl, params, data, getAxisDomain) {
    const xCol    = data.getData(params.x)
    const yCol    = data.getData(params.y)
    const valCol  = data.getData(params.value)

    const W = params.resolutionX | 0
    const H = params.resolutionY | 0
    const radius         = params.radius ?? 5.0
    const w1             = params.w1 ?? 0.5
    const w2             = params.w2 ?? 0.3
    const w3             = params.w3 ?? 0.2
    const fullCoordinates = params.full_coordinates ?? false

    const N = xCol.length
    const pickIds = new Float32Array(N)
    for (let i = 0; i < N; i++) pickIds[i] = i

    const xTex    = xCol.toTexture(regl)
    const yTex    = yCol.toTexture(regl)
    const valTex  = valCol.toTexture(regl)

    const xDomain = colDomain(xCol)
    const yDomain = colDomain(yCol)

    const accum1 = makeSplatPass(regl, W, H, pickIds, xTex, yTex, valTex, xDomain, yDomain, radius)
    const accum2 = makeSplatPass(regl, W, H, pickIds, xTex, yTex, valTex, xDomain, yDomain, radius * 2)
    const accum3 = makeSplatPass(regl, W, H, pickIds, xTex, yTex, valTex, xDomain, yDomain, radius * 4)

    const valueTex = makeValueTexture(regl, W, H, accum1, accum2, accum3, w1, w2, w3)

    const coordShape = fullCoordinates ? [W, H] : [2, 2]
    const { xTex: xOutTex, yTex: yOutTex } = fullCoordinates
      ? makeCoordTexturesFull(regl, W, H, xDomain, yDomain)
      : makeCoordTexturesCorners(regl, xDomain, yDomain)

    const xQK  = (typeof params.x     === 'string' && data) ? (data.getQuantityKind(params.x)     ?? null) : null
    const yQK  = (typeof params.y     === 'string' && data) ? (data.getQuantityKind(params.y)     ?? null) : null
    const valQK = (typeof params.value === 'string' && data) ? (data.getQuantityKind(params.value) ?? null) : null

    return {
      value: valueTex,
      x:     xOutTex,
      y:     yOutTex,
      _meta: {
        domains:      { value: null, x: xDomain, y: yDomain },
        quantityKinds: { value: valQK, x: xQK, y: yQK },
        shapes:       { value: [W, H], x: coordShape, y: coordShape },
      }
    }
  }

  schema(data) {
    const cols = data ? data.columns() : []
    return {
      type: 'object',
      title: 'Scatter2dInterpolate',
      properties: {
        x:                { type: 'string', enum: cols },
        y:                { type: 'string', enum: cols },
        value:            { type: 'string', enum: cols },
        resolutionX:      { type: 'integer', default: 256 },
        resolutionY:      { type: 'integer', default: 256 },
        radius:           { type: 'number',  default: 5.0 },
        w1:               { type: 'number',  default: 0.5 },
        w2:               { type: 'number',  default: 0.3 },
        w3:               { type: 'number',  default: 0.2 },
        full_coordinates: { type: 'boolean', default: false },
      },
      required: ['x', 'y', 'value', 'resolutionX', 'resolutionY']
    }
  }
}

registerComputedData('Scatter2dInterpolate', new Scatter2dInterpolateData())
