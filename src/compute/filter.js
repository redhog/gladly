import { registerTextureComputation, TextureComputation, EXPRESSION_REF, dataShape, resolveQuantityKind } from "./ComputationRegistry.js"

function toTexture(regl, input, length) {
  if (input instanceof Float32Array) {
    const [w, h] = dataShape(regl, length)
    const data = new Float32Array(w * h * 4)
    data.set(input)
    const tex = regl.texture({ data, shape: [w, h], type: 'float', format: 'rgba' })
    tex._dataLength = length
    tex._packed = true
    return tex
  }
  return input // already a texture
}

function subtractTextures(regl, texA, texB) {
  const w = texA.width
  const h = texA.height
  const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
  const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })

  regl({
    framebuffer: outputFBO,
    vert: `#version 300 es
      precision highp float;
      in vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
    frag: `#version 300 es
      precision highp float;
      uniform sampler2D texA;
      uniform sampler2D texB;
      out vec4 fragColor;
      void main() {
        ivec2 coord = ivec2(gl_FragCoord.xy);
        fragColor = texelFetch(texA, coord, 0) - texelFetch(texB, coord, 0);
      }
    `,
    attributes: { position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
    uniforms: { texA, texB },
    count: 4,
    primitive: 'triangle strip'
  })()

  if (texA._dataLength !== undefined) outputTex._dataLength = texA._dataLength
  outputTex._packed = true
  return outputTex
}

/**
 * Generic 1D convolution filter
 * @param {regl} regl - regl context
 * @param {Float32Array | Texture} input - CPU array or GPU texture
 * @param {Float32Array} kernel - 1D kernel
 * @returns {Texture} - filtered output texture
 */
function filter1D(regl, input, kernel) {
  const length = input instanceof Float32Array ? input.length : (input._dataLength ?? input.width * input.height)
  const inputTex = toTexture(regl, input, length)
  const w = inputTex.width
  const h = inputTex.height

  const kernelData = new Float32Array(kernel.length * 4)
  for (let i = 0; i < kernel.length; i++) kernelData[i * 4] = kernel[i]
  const kernelTex = regl.texture({ data: kernelData, shape: [kernel.length, 1], type: 'float', format: 'rgba' })
  const outputTex = regl.texture({ width: w, height: h, type: 'float', format: 'rgba' })
  const outputFBO = regl.framebuffer({ color: outputTex, depth: false, stencil: false })

  const radius = Math.floor(kernel.length / 2)

  regl({
    framebuffer: outputFBO,
    vert: `#version 300 es
      precision highp float;
      in vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
    frag: `#version 300 es
      precision highp float;
      uniform sampler2D inputTex;
      uniform sampler2D kernelTex;
      uniform int radius;
      uniform int texWidth;
      uniform int totalLength;
      out vec4 fragColor;

      void main() {
        ivec2 coord = ivec2(gl_FragCoord.xy);
        int di = (coord.y * texWidth + coord.x) * 4;
        vec4 sums = vec4(0.0);
        for (int i = -16; i <= 16; i++) { // max kernel radius 16
          if (i + 16 >= radius * 2 + 1) break;
          float kw = texelFetch(kernelTex, ivec2(i + radius, 0), 0).r;
          for (int c = 0; c < 4; c++) {
            int si = clamp(di + c + i, 0, totalLength - 1);
            ivec2 sc = ivec2((si / 4) % texWidth, (si / 4) / texWidth);
            sums[c] += texelFetch(inputTex, sc, 0)[si % 4] * kw;
          }
        }
        fragColor = sums;
      }
    `,
    attributes: { position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
    uniforms: { inputTex, kernelTex, radius, texWidth: w, totalLength: length },
    count: 4,
    primitive: 'triangle strip'
  })()

  outputTex._dataLength = length
  outputTex._packed = true
  return outputTex
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
  getQuantityKind(params, data) { return resolveQuantityKind(params.input, data) }
  compute(regl, params, data, getAxisDomain) {
    const input = this.resolveDataParam(regl, data, params.input)
    return filter1D(regl, input, params.kernel)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'filter1D',
      properties: {
        input: EXPRESSION_REF,
        kernel: EXPRESSION_REF
      },
      required: ['input', 'kernel']
    }
  }
}

class LowPassComputation extends TextureComputation {
  getQuantityKind(params, data) { return resolveQuantityKind(params.input, data) }
  compute(regl, params, data, getAxisDomain) {
    const input = this.resolveDataParam(regl, data, params.input)
    return lowPass(regl, input, params.sigma, params.kernelSize)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'lowPass',
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
  getQuantityKind(params, data) { return resolveQuantityKind(params.input, data) }
  compute(regl, params, data, getAxisDomain) {
    const input = this.resolveDataParam(regl, data, params.input)
    return highPass(regl, input, params.sigma, params.kernelSize)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'highPass',
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
  getQuantityKind(params, data) { return resolveQuantityKind(params.input, data) }
  compute(regl, params, data, getAxisDomain) {
    const input = this.resolveDataParam(regl, data, params.input)
    return bandPass(regl, input, params.sigmaLow, params.sigmaHigh)
  }
  schema(data) {
    return {
      type: 'object',
      title: 'bandPass',
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
