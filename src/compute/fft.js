import { registerTextureComputation, registerComputedData, EXPRESSION_REF, resolveQuantityKind } from "./ComputationRegistry.js"
import { TextureComputation, ComputedData } from "../data/Computation.js"
import { ArrayColumn } from "../data/ColumnData.js"

/* ============================================================
   Utilities
   ============================================================ */

function nextPow2(n) {
  return 1 << Math.ceil(Math.log2(n));
}

// Internal: complex texture (R=real, G=imag per frequency bin), 1 element per texel.
// Not exposed via sampleColumn — only used as intermediate within this module.
function makeComplexTexture(regl, data, N) {
  // data: Float32Array (real), imag assumed 0
  const texData = new Float32Array(N * 4);
  for (let i = 0; i < data.length; i++) {
    texData[i * 4] = data[i];
  }
  return regl.texture({
    data: texData,
    width: N,
    height: 1,
    format: "rgba",
    type: "float",
    min: "nearest",
    mag: "nearest",
    wrap: "clamp"
  });
}

function makeEmptyComplexTexture(regl, N) {
  return regl.texture({
    width: N,
    height: 1,
    format: "rgba",
    type: "float",
    min: "nearest",
    mag: "nearest",
    wrap: "clamp"
  });
}

function makeFBO(regl, tex) {
  return regl.framebuffer({ color: tex, depth: false, stencil: false });
}

/* ============================================================
   Fullscreen quad
   ============================================================ */

const quad = {
  attributes: {
    position: [[-1, -1], [1, -1], [-1, 1], [1, 1]]
  },
  count: 4,
  primitive: "triangle strip"
};

/* ============================================================
   FFT shaders
   ============================================================ */

function bitReversePass(regl, N) {
  return regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D inputTex;
    uniform int N;
    out vec4 outColor;

    int bitReverse(int x, int bits) {
      int y = 0;
      for (int i = 0; i < 16; i++) {
        if (i >= bits) break;
        y = (y << 1) | (x & 1);
        x >>= 1;
      }
      return y;
    }

    void main() {
      int x = int(gl_FragCoord.x);
      int bits = int(log2(float(N)));
      int rx = bitReverse(x, bits);
      vec2 v = texelFetch(inputTex, ivec2(rx, 0), 0).rg;
      outColor = vec4(v, 0.0, 1.0);
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    uniforms: {
      inputTex: regl.prop("input"),
      N
    },
    framebuffer: regl.prop("fbo"),
    ...quad
  });
}

function fftStagePass(regl, stage, inverse) {
  return regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D inputTex;
    uniform int stage;
    uniform int N;
    out vec4 outColor;

    void main() {
      int x = int(gl_FragCoord.x);
      int half = stage >> 1;
      int block = (x / stage) * stage;
      int i = block + (x % half);
      int j = i + half;

      vec2 a = texelFetch(inputTex, ivec2(i, 0), 0).rg;
      vec2 b = texelFetch(inputTex, ivec2(j, 0), 0).rg;

      float sign = ${inverse ? "1.0" : "-1.0"};
      float angle = sign * 6.28318530718 * float(x % stage) / float(stage);
      vec2 w = vec2(cos(angle), sin(angle));

      vec2 t = vec2(
        b.x * w.x - b.y * w.y,
        b.x * w.y + b.y * w.x
      );

      vec2 outv = (x < j) ? a + t : a - t;
      outColor = vec4(outv, 0.0, 1.0);
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    uniforms: {
      inputTex: regl.prop("input"),
      stage,
      N: regl.prop("N")
    },
    framebuffer: regl.prop("fbo"),
    ...quad
  });
}

function scalePass(regl, N) {
  return regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D inputTex;
    out vec4 outColor;
    void main() {
      vec2 v = texelFetch(inputTex, ivec2(int(gl_FragCoord.x),0),0).rg;
      outColor = vec4(v / float(${N}), 0.0, 1.0);
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    uniforms: {
      inputTex: regl.prop("input")
    },
    framebuffer: regl.prop("fbo"),
    ...quad
  });
}

// If a single batch of FFT stages takes longer than this, yield before the next batch.
const TDR_STEP_MS = 500

/* ============================================================
   Internal GPU FFT — returns a complex texture (R=real, G=imag)
   with 1 frequency bin per texel. NOT for direct use with sampleColumn.
   ============================================================ */

export async function fft1d(regl, realArray, inverse = false) {
  const N = nextPow2(realArray.length);

  let texA = makeComplexTexture(regl, realArray, N);
  let texB = makeEmptyComplexTexture(regl, N);
  let fboA = makeFBO(regl, texA);
  let fboB = makeFBO(regl, texB);

  // bit reversal
  bitReversePass(regl, N)({
    input: texA,
    fbo: fboB
  });
  [fboA, fboB] = [fboB, fboA];

  // FFT stages — yield between batches to avoid triggering the Windows TDR watchdog.
  const stages = Math.log2(N);
  let batchStart = performance.now();
  for (let s = 1; s <= stages; s++) {
    fftStagePass(regl, 1 << s, inverse)({
      input: fboA,
      N,
      fbo: fboB
    });
    [fboA, fboB] = [fboB, fboA];
    if (performance.now() - batchStart > TDR_STEP_MS) {
      await new Promise(r => requestAnimationFrame(r));
      batchStart = performance.now();
    }
  }

  // scale for inverse
  if (inverse) {
    scalePass(regl, N)({
      input: fboA,
      fbo: fboB
    });
    return fboB.color[0];
  }

  return fboA.color[0];
}

/* ============================================================
   FFT-based convolution (internal)
   ============================================================ */

export async function fftConvolution(regl, signal, kernel) {
  const N = nextPow2(signal.length + kernel.length);

  const sigTex = await fft1d(regl, signal, false);
  const kerTex = await fft1d(regl, kernel, false);

  const outTex = makeEmptyComplexTexture(regl, N);
  const outFBO = makeFBO(regl, outTex);

  // pointwise complex multiply
  regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D A, B;
    out vec4 outColor;
    void main() {
      int x = int(gl_FragCoord.x);
      vec2 a = texelFetch(A, ivec2(x,0),0).rg;
      vec2 b = texelFetch(B, ivec2(x,0),0).rg;
      outColor = vec4(
        a.x*b.x - a.y*b.y,
        a.x*b.y + a.y*b.x,
        0, 1
      );
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position,0,1);
    }`,
    uniforms: {
      A: sigTex,
      B: kerTex
    },
    framebuffer: outFBO,
    ...quad
  })();

  // inverse FFT
  return await fft1d(regl, new Float32Array(N), true);
}

/* ============================================================
   extractAndRepack: extract one channel from a complex texture
   (1 element per texel, R=real/G=imag) into a 4-packed RGBA texture.
   channelSwizzle: 'r' for real part, 'g' for imaginary part.
   ============================================================ */

function extractAndRepack(regl, complexTex, channelSwizzle, N) {
  const nTexels = Math.ceil(N / 4)
  const w = Math.min(nTexels, regl.limits.maxTextureSize)
  const h = Math.ceil(nTexels / w)
  const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
  const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })

  regl({
    framebuffer: outputFBO,
    vert: `#version 300 es
    in vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`,
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D complexTex;
    uniform int totalLength;
    out vec4 fragColor;
    void main() {
      int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
      int base = texelI * 4;
      float v0 = base + 0 < totalLength ? texelFetch(complexTex, ivec2(base+0, 0), 0).${channelSwizzle} : 0.0;
      float v1 = base + 1 < totalLength ? texelFetch(complexTex, ivec2(base+1, 0), 0).${channelSwizzle} : 0.0;
      float v2 = base + 2 < totalLength ? texelFetch(complexTex, ivec2(base+2, 0), 0).${channelSwizzle} : 0.0;
      float v3 = base + 3 < totalLength ? texelFetch(complexTex, ivec2(base+3, 0), 0).${channelSwizzle} : 0.0;
      fragColor = vec4(v0, v1, v2, v3);
    }`,
    attributes: { position: [[-1,-1],[1,-1],[-1,1],[1,1]] },
    uniforms: { complexTex, totalLength: N },
    count: 4,
    primitive: 'triangle strip'
  })()

  outputTex._dataLength = N
  return outputTex
}

/* ============================================================
   FftData — ComputedData producing 'real' and 'imag' columns
   ============================================================ */

class FftData extends ComputedData {
  columns() { return ['real', 'imag'] }

  async compute(regl, params, data, getAxisDomain) {
    const inputCol = data.getData(params.input)
    if (!(inputCol instanceof ArrayColumn)) {
      throw new Error(`FftData: input '${params.input}' must be a plain data column`)
    }
    const N = nextPow2(inputCol.array.length)
    const complexTex = await fft1d(regl, inputCol.array, params.inverse ?? false)
    return {
      real: extractAndRepack(regl, complexTex, 'r', N),
      imag: extractAndRepack(regl, complexTex, 'g', N),
      _meta: {
        domains: { real: null, imag: null },
        quantityKinds: { real: null, imag: null }
      }
    }
  }

  schema(data) {
    const cols = data ? data.columns() : []
    return {
      type: 'object',
      title: 'FftData',
      properties: {
        input: { type: 'string', enum: cols, description: 'Input signal column' },
        inverse: { type: 'boolean', default: false, description: 'Inverse FFT' }
      },
      required: ['input']
    }
  }
}

registerComputedData('FftData', new FftData())

/* ============================================================
   FftConvolutionComputation — TextureComputation (real output)
   ============================================================ */

class FftConvolutionComputation extends TextureComputation {
  getQuantityKind(params, data) { return resolveQuantityKind(params.signal, data) }
  async compute(regl, params, data, getAxisDomain) {
    const signal = params.signal instanceof ArrayColumn ? params.signal.array : params.signal
    const kernel = params.kernel instanceof ArrayColumn ? params.kernel.array : params.kernel
    const N = nextPow2(signal.length + kernel.length)
    const complexResult = await fftConvolution(regl, signal, kernel)
    return extractAndRepack(regl, complexResult, 'r', N)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'fftConvolution',
      properties: {
        signal: EXPRESSION_REF,
        kernel: EXPRESSION_REF
      },
      required: ['signal', 'kernel']
    }
  }
}

registerTextureComputation('fftConvolution', new FftConvolutionComputation())
