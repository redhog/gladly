import { fftConvolution } from "./fft.js"
import { registerTextureComputation } from "./ComputationRegistry.js"

/*
  ============================================================
  Utilities
  ============================================================
*/

const MAX_KERNEL_LOOP = 1024;

function nextPow2(n) {
  return 1 << Math.ceil(Math.log2(n));
}

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

function makeFBO(regl, width) {
  return regl.framebuffer({
    color: regl.texture({
      width,
      height: 1,
      format: "rgba",
      type: "float"
    })
  });
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

    return fbo.color[0];
  }

  // Case 2: chunked
  if (K <= 8192) {
    return chunked({
      signalTex,
      kernel: kernelArray,
      N
    });
  }

  // Case 3: FFT
  return fftConvolution(regl, signalArray, kernelArray);
}

// params: { signal: Float32Array, kernel: Float32Array }
registerTextureComputation('convolution', (regl, params) =>
  adaptiveConvolution(regl, params.signal, params.kernel))
