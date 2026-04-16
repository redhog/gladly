import { fftConvolution } from "./fft.js"
import { registerTextureComputation, EXPRESSION_REF, resolveQuantityKind } from "./ComputationRegistry.js"
import { TextureComputation } from "../data/Computation.js"

/*
  ============================================================
  Utilities
  ============================================================
*/

const MAX_KERNEL_LOOP = 1024;

function nextPow2(n) {
  return 1 << Math.ceil(Math.log2(n));
}

// Internal: builds a 1-value-per-texel R-channel texture (not exposed via sampleColumn)
function make1DTexture(regl, data, width) {
  return regl.texture({
    data,
    width,
    height: 1,
    format: "rgba",
    type: "float",
    wrap: "clamp",
    min: "nearest",
    mag: "nearest"
  });
}

// Internal: creates an R-channel FBO of given width
function makeFBO(regl, width) {
  return regl.framebuffer({
    color: regl.texture({
      width,
      height: 1,
      format: "rgba",
      type: "float"
    }),
    depth: false,
    stencil: false,
  });
}

// Repack a 1-value-per-texel R-channel texture into a 4-packed RGBA texture.
// The source texture has elements at (i % srcW, i / srcW).r
// The output has elements packed 4 per texel, _dataLength set.
function repackToQuadTexture(regl, sourceTex, N) {
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
    uniform sampler2D sourceTex;
    uniform int totalLength;
    out vec4 fragColor;
    void main() {
      ivec2 srcSz = textureSize(sourceTex, 0);
      int texelI = int(gl_FragCoord.y) * ${w} + int(gl_FragCoord.x);
      int base = texelI * 4;
      float v0 = base + 0 < totalLength ? texelFetch(sourceTex, ivec2((base+0) % srcSz.x, (base+0) / srcSz.x), 0).r : 0.0;
      float v1 = base + 1 < totalLength ? texelFetch(sourceTex, ivec2((base+1) % srcSz.x, (base+1) / srcSz.x), 0).r : 0.0;
      float v2 = base + 2 < totalLength ? texelFetch(sourceTex, ivec2((base+2) % srcSz.x, (base+2) / srcSz.x), 0).r : 0.0;
      float v3 = base + 3 < totalLength ? texelFetch(sourceTex, ivec2((base+3) % srcSz.x, (base+3) / srcSz.x), 0).r : 0.0;
      fragColor = vec4(v0, v1, v2, v3);
    }`,
    attributes: { position: [[-1,-1],[1,-1],[-1,1],[1,1]] },
    uniforms: { sourceTex, totalLength: N },
    count: 4,
    primitive: 'triangle strip'
  })()

  outputTex._dataLength = N
  return outputTex
}

/*
  ============================================================
  1) Single-pass convolution (kernel ≤ 1024)
  ============================================================
*/

function singlePassConvolution(regl) {
  return regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D signal, kernel;
    uniform int N, K;
    out vec4 outColor;

    void main() {
      int x = int(gl_FragCoord.x);
      float sum = 0.0;

      for (int i = 0; i < ${MAX_KERNEL_LOOP}; i++) {
        if (i >= K) break;
        int xi = x - i;
        if (xi < 0 || xi >= N) continue;

        float s = texelFetch(signal, ivec2(xi, 0), 0).r;
        float k = texelFetch(kernel, ivec2(i, 0), 0).r;
        sum += s * k;
      }

      outColor = vec4(sum, 0, 0, 1);
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    attributes: {
      position: [[-1,-1],[1,-1],[-1,1],[1,1]]
    },
    uniforms: {
      signal: regl.prop("signal"),
      kernel: regl.prop("kernel"),
      N: regl.prop("N"),
      K: regl.prop("K")
    },
    framebuffer: regl.prop("fbo"),
    count: 4,
    primitive: "triangle strip"
  });
}

/*
  ============================================================
  2) Two-pass chunked convolution (arbitrary kernel size)
  ============================================================
*/

function chunkedConvolution(regl) {
  const partialPass = regl({
    frag: `#version 300 es
    precision highp float;
    uniform sampler2D signal, kernel2D;
    uniform int N, chunkOffset;
    out vec4 outColor;

    void main() {
      int x = int(gl_FragCoord.x);
      float sum = 0.0;

      for (int i = 0; i < ${MAX_KERNEL_LOOP}; i++) {
        int kIndex = chunkOffset + i;
        int xi = x - kIndex;
        if (xi < 0 || xi >= N) continue;

        float s = texelFetch(signal, ivec2(xi, 0), 0).r;
        float k = texelFetch(kernel2D, ivec2(i, 0), 0).r;
        sum += s * k;
      }

      outColor = vec4(sum, 0, 0, 1);
    }`,
    vert: `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    attributes: {
      position: [[-1,-1],[1,-1],[-1,1],[1,1]]
    },
    uniforms: {
      signal: regl.prop("signal"),
      kernel2D: regl.prop("kernel"),
      N: regl.prop("N"),
      chunkOffset: regl.prop("offset")
    },
    framebuffer: regl.prop("fbo"),
    blend: {
      enable: true,
      func: { src: "one", dst: "one" }
    },
    count: 4,
    primitive: "triangle strip"
  });

  return function run({ signalTex, kernel, N }) {
    const chunks = Math.ceil(kernel.length / MAX_KERNEL_LOOP);
    const fbo = makeFBO(regl, N);

    regl.clear({ framebuffer: fbo, color: [0,0,0,0] });

    for (let c = 0; c < chunks; c++) {
      const slice = kernel.slice(
        c * MAX_KERNEL_LOOP,
        (c + 1) * MAX_KERNEL_LOOP
      );

      const kernelTex = make1DTexture(regl, slice, MAX_KERNEL_LOOP);

      partialPass({
        signal: signalTex,
        kernel: kernelTex,
        N,
        offset: c * MAX_KERNEL_LOOP,
        fbo
      });
    }

    return fbo.color[0];
  };
}

/*
  ============================================================
  Adaptive wrapper
  ============================================================
*/

export default function adaptiveConvolution(regl, signalArray, kernelArray) {
  const single = singlePassConvolution(regl);
  const chunked = chunkedConvolution(regl);

  const N = signalArray.length;
  const K = kernelArray.length;

  const signalTex = make1DTexture(regl, signalArray, N);

  let result;

  // Case 1: single pass
  if (K <= MAX_KERNEL_LOOP) {
    const kernelTex = make1DTexture(regl, kernelArray, K);
    const fbo = makeFBO(regl, N);

    single({
      signal: signalTex,
      kernel: kernelTex,
      N,
      K,
      fbo
    });

    result = fbo.color[0];
  }

  // Case 2: chunked
  else if (K <= 8192) {
    result = chunked({
      signalTex,
      kernel: kernelArray,
      N
    });
  }

  // Case 3: FFT
  else {
    result = fftConvolution(regl, signalArray, kernelArray);
  }

  // Repack internal R-channel result into 4-packed output for sampleColumn
  return repackToQuadTexture(regl, result, N);
}

class ConvolutionComputation extends TextureComputation {
  getQuantityKind(params, data) { return resolveQuantityKind(params.signal, data) }
  async compute(regl, params, data, getAxisDomain) {
    const signal = typeof params.signal === 'string' ? data.getData(params.signal) : params.signal
    const kernel = typeof params.kernel === 'string' ? data.getData(params.kernel) : params.kernel
    return adaptiveConvolution(regl, signal, kernel)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'convolution',
      properties: {
        signal: EXPRESSION_REF,
        kernel: EXPRESSION_REF
      },
      required: ['signal', 'kernel']
    }
  }
}

registerTextureComputation('convolution', new ConvolutionComputation())
