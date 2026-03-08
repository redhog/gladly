import { registerTextureComputation, EXPRESSION_REF, resolveQuantityKind } from "./ComputationRegistry.js"
import { TextureComputation } from "../data/Computation.js"
import { ArrayColumn, SAMPLE_COLUMN_GLSL } from "../data/ColumnData.js"

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
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
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
  return outputTex
}

/**
 * Generic 1D convolution filter
 * @param {regl} regl - regl context
 * @param {Texture} inputTex - 4-packed GPU texture, _dataLength set
 * @param {Float32Array} kernel - 1D kernel weights
 * @returns {Texture} - filtered output texture (4-packed, same dimensions as input)
 */
function filter1D(regl, inputTex, kernel) {
  const length = inputTex._dataLength ?? inputTex.width * inputTex.height * 4
  const w = inputTex.width
  const h = inputTex.height

  // Kernel texture stays R-channel (internal, not exposed via sampleColumn)
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
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `,
    frag: `#version 300 es
      precision highp float;
      precision highp sampler2D;
      uniform sampler2D inputTex;
      uniform sampler2D kernelTex;
      uniform int radius;
      uniform int totalLength;
      out vec4 fragColor;
      ${SAMPLE_COLUMN_GLSL}
      void main() {
        ivec2 sz = textureSize(inputTex, 0);
        int texelI = int(gl_FragCoord.y) * sz.x + int(gl_FragCoord.x);
        int base = texelI * 4;
        float s0 = 0.0, s1 = 0.0, s2 = 0.0, s3 = 0.0;
        for (int i = -16; i <= 16; i++) {
          if (i + 16 >= radius * 2 + 1) break;
          float kw = texelFetch(kernelTex, ivec2(i + radius, 0), 0).r;
          s0 += sampleColumn(inputTex, float(clamp(base + 0 + i, 0, totalLength - 1))) * kw;
          s1 += sampleColumn(inputTex, float(clamp(base + 1 + i, 0, totalLength - 1))) * kw;
          s2 += sampleColumn(inputTex, float(clamp(base + 2 + i, 0, totalLength - 1))) * kw;
          s3 += sampleColumn(inputTex, float(clamp(base + 3 + i, 0, totalLength - 1))) * kw;
        }
        fragColor = vec4(s0, s1, s2, s3);
      }
    `,
    attributes: { position: [[-1, -1], [1, -1], [-1, 1], [1, 1]] },
    uniforms: { inputTex, kernelTex, radius, totalLength: length },
    count: 4,
    primitive: 'triangle strip'
  })()

  outputTex._dataLength = length
  return outputTex
}

// Gaussian kernel helper
function gaussianKernel(size, sigma) {
  const radius = Math.floor(size / 2)
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2)
    kernel[i + radius] = v
    sum += v
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  return kernel
}

/**
 * Low-pass filter
 * @param {regl} regl
 * @param {Texture} inputTex - 4-packed GPU texture
 */
function lowPass(regl, inputTex, sigma = 3, kernelSize = null) {
  const size = kernelSize || (Math.ceil(sigma * 6) | 1) // ensure odd
  const kernel = gaussianKernel(size, sigma)
  return filter1D(regl, inputTex, kernel)
}

/**
 * High-pass filter: subtract low-pass
 * @param {regl} regl
 * @param {Texture} inputTex - 4-packed GPU texture
 */
function highPass(regl, inputTex, sigma = 3, kernelSize = null) {
  const low = lowPass(regl, inputTex, sigma, kernelSize)
  return subtractTextures(regl, inputTex, low)
}

/**
 * Band-pass filter: difference of low-pass filters
 * @param {regl} regl
 * @param {Texture} inputTex - 4-packed GPU texture
 */
function bandPass(regl, inputTex, sigmaLow, sigmaHigh) {
  const lowHigh = lowPass(regl, inputTex, sigmaHigh)
  const lowLow  = lowPass(regl, inputTex, sigmaLow)
  return subtractTextures(regl, lowHigh, lowLow)
}

export { filter1D, gaussianKernel, lowPass, highPass, bandPass }

class Filter1DComputation extends TextureComputation {
  getQuantityKind(params, data) { return resolveQuantityKind(params.input, data) }
  compute(regl, inputs, getAxisDomain) {
    const inputTex = inputs.input.toTexture(regl)
    const kernelArr = inputs.kernel instanceof ArrayColumn ? inputs.kernel.array : inputs.kernel
    return filter1D(regl, inputTex, kernelArr)
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
  compute(regl, inputs, getAxisDomain) {
    return lowPass(regl, inputs.input.toTexture(regl), inputs.sigma, inputs.kernelSize)
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
  compute(regl, inputs, getAxisDomain) {
    return highPass(regl, inputs.input.toTexture(regl), inputs.sigma, inputs.kernelSize)
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
  compute(regl, inputs, getAxisDomain) {
    return bandPass(regl, inputs.input.toTexture(regl), inputs.sigmaLow, inputs.sigmaHigh)
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
