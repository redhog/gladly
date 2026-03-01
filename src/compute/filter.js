import { registerTextureComputation, TextureComputation, EXPRESSION_REF } from "./ComputationRegistry.js"

function toTexture(regl, input, length) {
  if (input instanceof Float32Array) {
    return regl.texture({ data: input, shape: [length, 1], type: 'float', format: 'rgba' });
  }
  return input; // already a texture
}

function subtractTextures(regl, texA, texB) {
  const length = texA.width;
  const outputTex = regl.texture({ width: length, height: 1, type: 'float', format: 'rgba' });
  const outputFBO = regl.framebuffer({ color: outputTex });

  const drawSub = regl({
    framebuffer: outputFBO,
    vert: `
      precision highp float;
      attribute float bin;
      void main() {
        float x = (bin + 0.5)/${length}.0*2.0 - 1.0;
        gl_Position = vec4(x,0.0,0.0,1.0);
      }
    `,
    frag: `
      precision highp float;
      uniform sampler2D texA;
      uniform sampler2D texB;
      out vec4 fragColor;
      void main() {
        int idx = int(gl_FragCoord.x-0.5);
        float a = texelFetch(texA, ivec2(idx,0),0).r;
        float b = texelFetch(texB, ivec2(idx,0),0).r;
        fragColor = vec4(a-b,0.0,0.0,1.0);
      }
    `,
    attributes: { bin: Array.from({ length }, (_, i) => i) },
    uniforms: { texA, texB },
    count: length,
    primitive: 'points'
  });

  drawSub();
  return outputTex;
}

/**
 * Generic 1D convolution filter
 * @param {regl} regl - regl context
 * @param {Float32Array | Texture} input - CPU array or GPU texture
 * @param {Float32Array} kernel - 1D kernel
 * @returns {Texture} - filtered output texture
 */
function filter1D(regl, input, kernel) {
  const length = input instanceof Float32Array ? input.length : input.width;
  const inputTex = toTexture(regl, input, length);

  const kernelTex = regl.texture({ data: kernel, shape: [kernel.length, 1], type: 'float' });

  const outputTex = regl.texture({ width: length, height: 1, type: 'float', format: 'rgba' });
  const outputFBO = regl.framebuffer({ color: outputTex });

  const radius = Math.floor(kernel.length / 2);

  const drawFilter = regl({
    framebuffer: outputFBO,
    vert: `
      precision highp float;
      attribute float bin;
      void main() {
        float x = (bin + 0.5)/${length}.0*2.0 - 1.0;
        gl_Position = vec4(x, 0.0, 0.0, 1.0);
      }
    `,
    frag: `
      #version 300 es
      precision highp float;
      uniform sampler2D inputTex;
      uniform sampler2D kernelTex;
      uniform int radius;
      uniform int length;
      out vec4 fragColor;

      void main() {
        float idx = gl_FragCoord.x - 0.5;
        float sum = 0.0;
        for (int i=-16; i<=16; i++) { // max kernel radius 16
          if (i+16 >= radius*2+1) break;
          int sampleIdx = int(clamp(idx + float(i), 0.0, float(length-1)));
          float val = texelFetch(inputTex, ivec2(sampleIdx,0),0).r;
          float w = texelFetch(kernelTex, ivec2(i+radius,0),0).r;
          sum += val * w;
        }
        fragColor = vec4(sum,0.0,0.0,1.0);
      }
    `,
    attributes: {
      bin: Array.from({ length }, (_, i) => i)
    },
    uniforms: {
      inputTex,
      kernelTex,
      radius,
      length
    },
    count: length,
    primitive: 'points'
  });

  drawFilter();
  return outputTex;
}

// Gaussian kernel helper
function gaussianKernel(size, sigma) {
  const radius = Math.floor(size / 2);
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

/**
 * Low-pass filter
 */
function lowPass(regl, input, sigma = 3, kernelSize = null) {
  const size = kernelSize || Math.ceil(sigma*6)|1; // ensure odd
  const kernel = gaussianKernel(size, sigma);
  return filter1D(regl, input, kernel);
}

/**
 * High-pass filter: subtract low-pass
 */
function highPass(regl, input, sigma = 3, kernelSize = null) {
  const low = lowPass(regl, input, sigma, kernelSize);
  // high = input - low (using a shader)
  return subtractTextures(regl, input, low);
}

/**
 * Band-pass filter: difference of low-pass filters
 */
function bandPass(regl, input, sigmaLow, sigmaHigh) {
  const lowHigh = lowPass(regl, input, sigmaHigh);
  const lowLow = lowPass(regl, input, sigmaLow);
  return subtractTextures(regl, lowHigh, lowLow);
}

export { filter1D, gaussianKernel, lowPass, highPass, bandPass }

class Filter1DComputation extends TextureComputation {
  compute(regl, params) {
    return filter1D(regl, params.input, params.kernel)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        kernel: EXPRESSION_REF
      },
      required: ['input', 'kernel']
    }
  }
}

class LowPassComputation extends TextureComputation {
  compute(regl, params) {
    return lowPass(regl, params.input, params.sigma, params.kernelSize)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        sigma: { type: 'number' },
        kernelSize: { type: 'number' }
      },
      required: ['input']
    }
  }
}

class HighPassComputation extends TextureComputation {
  compute(regl, params) {
    return highPass(regl, params.input, params.sigma, params.kernelSize)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        sigma: { type: 'number' },
        kernelSize: { type: 'number' }
      },
      required: ['input']
    }
  }
}

class BandPassComputation extends TextureComputation {
  compute(regl, params) {
    return bandPass(regl, params.input, params.sigmaLow, params.sigmaHigh)
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        sigmaLow: { type: 'number' },
        sigmaHigh: { type: 'number' }
      },
      required: ['input', 'sigmaLow', 'sigmaHigh']
    }
  }
}

registerTextureComputation('filter1D', new Filter1DComputation())
registerTextureComputation('lowPass',  new LowPassComputation())
registerTextureComputation('highPass', new HighPassComputation())
registerTextureComputation('bandPass', new BandPassComputation())
