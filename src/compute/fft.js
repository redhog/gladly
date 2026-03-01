import { registerTextureComputation, TextureComputation, EXPRESSION_REF } from "./ComputationRegistry.js"

/* ============================================================
   Utilities
   ============================================================ */

function nextPow2(n) {
  return 1 << Math.ceil(Math.log2(n));
}

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
  return regl.framebuffer({ color: tex });
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

/* ============================================================
   Public: GPU FFT (top-level API)
   ============================================================ */

export function fft1d(regl, realArray, inverse = false) {
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

  // FFT stages
  const stages = Math.log2(N);
  for (let s = 1; s <= stages; s++) {
    fftStagePass(regl, 1 << s, inverse)({
      input: fboA,
      N,
      fbo: fboB
    });
    [fboA, fboB] = [fboB, fboA];
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
   FFT-based convolution
   ============================================================ */

export function fftConvolution(regl, signal, kernel) {
  const N = nextPow2(signal.length + kernel.length);

  const sigTex = fft1d(regl, signal, false);
  const kerTex = fft1d(regl, kernel, false);

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
  return fft1d(regl, new Float32Array(N), true);
}

class Fft1dComputation extends TextureComputation {
  compute(regl, params) {
    return fft1d(regl, params.input, params.inverse ?? false)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        inverse: { type: 'boolean' }
      },
      required: ['input']
    }
  }
}

class FftConvolutionComputation extends TextureComputation {
  compute(regl, params) {
    return fftConvolution(regl, params.signal, params.kernel)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        signal: EXPRESSION_REF,
        kernel: EXPRESSION_REF
      },
      required: ['signal', 'kernel']
    }
  }
}

// fft1d: output is a complex texture — R = real part, G = imaginary part.
// Use a downstream computation (e.g. magnitude) to get a single scalar per bin.
registerTextureComputation('fft1d', new Fft1dComputation())
registerTextureComputation('fftConvolution', new FftConvolutionComputation())
