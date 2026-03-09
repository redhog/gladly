import { registerTextureComputation, EXPRESSION_REF, resolveQuantityKind } from "./ComputationRegistry.js"
import { TextureComputation } from "../data/Computation.js"
import { SAMPLE_COLUMN_GLSL } from "../data/ColumnData.js"

/**
 * Smooth a histogram to produce a KDE texture
 * @param {regl} regl - regl context
 * @param {Texture} histTex - 4-packed histogram texture (_dataLength = bins)
 * @param {Object} options
 *   - bandwidth: Gaussian sigma in bins (default 5)
 *   - bins: output bins (default same as input via _dataLength)
 * @returns {Texture} - smoothed KDE texture (4-packed, _dataLength = bins)
 */
export default function smoothKDE(regl, histTex, options = {}) {
  const bins = options.bins || histTex._dataLength || histTex.width * 4
  const bandwidth = options.bandwidth || 5.0

  const nTexels = Math.ceil(bins / 4)
  const wTexels = Math.min(nTexels, regl.limits.maxTextureSize)
  const hTexels = Math.ceil(nTexels / wTexels)

  const kdeTex = regl.texture({ width: wTexels, height: hTexels, type: 'float', format: 'rgba' })
  const kdeFBO = regl.framebuffer({ color: kdeTex, depth: false, stencil: false })

  const kernelRadius = Math.ceil(bandwidth * 3)
  const kernelSize = kernelRadius * 2 + 1
  const kernel = new Float32Array(kernelSize)
  let sum = 0
  for (let i = -kernelRadius; i <= kernelRadius; i++) {
    const w = Math.exp(-0.5 * (i / bandwidth) ** 2)
    kernel[i + kernelRadius] = w
    sum += w
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  // Kernel texture stays R-channel (internal, not exposed via sampleColumn)
  const kernelData = new Float32Array(kernelSize * 4)
  for (let i = 0; i < kernelSize; i++) kernelData[i * 4] = kernel[i]
  const kernelTex = regl.texture({ data: kernelData, shape: [kernelSize, 1], type: 'float', format: 'rgba' })

  const drawKDE = regl({
    framebuffer: kdeFBO,
    vert: `#version 300 es
      precision highp float;
      in vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `,
    frag: `#version 300 es
      precision highp float;
      precision highp sampler2D;
      uniform sampler2D histTex;
      uniform sampler2D kernelTex;
      uniform int kernelRadius;
      uniform int bins;
      out vec4 fragColor;
      ${SAMPLE_COLUMN_GLSL}
      void main() {
        int texelI = int(gl_FragCoord.y) * ${wTexels} + int(gl_FragCoord.x);
        int base = texelI * 4;
        float s0 = 0.0, s1 = 0.0, s2 = 0.0, s3 = 0.0;
        for (int i = -16; i <= 16; i++) {
          if (i + 16 >= kernelRadius * 2 + 1) break;
          float kw = texelFetch(kernelTex, ivec2(i + kernelRadius, 0), 0).r;
          s0 += sampleColumn(histTex, float(clamp(base + 0 + i, 0, bins - 1))) * kw;
          s1 += sampleColumn(histTex, float(clamp(base + 1 + i, 0, bins - 1))) * kw;
          s2 += sampleColumn(histTex, float(clamp(base + 2 + i, 0, bins - 1))) * kw;
          s3 += sampleColumn(histTex, float(clamp(base + 3 + i, 0, bins - 1))) * kw;
        }
        fragColor = vec4(s0, s1, s2, s3);
      }
    `,
    attributes: {
      position: [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    },
    uniforms: {
      histTex,
      kernelTex,
      kernelRadius,
      bins
    },
    count: 4,
    primitive: 'triangle strip'
  })

  drawKDE()

  kdeTex._dataLength = bins
  return kdeTex
}

class KdeComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    const inputTex = inputs.input.toTexture(regl)
    return smoothKDE(regl, inputTex, { bins: inputs.bins, bandwidth: inputs.bandwidth })
  }

  getQuantityKind(params, data) {
    return resolveQuantityKind(params.input, data)
  }

  schema(data) {
    return {
      type: 'object',
      title: 'kde',
      properties: {
        input: EXPRESSION_REF,
        bins: { type: 'number' },
        bandwidth: { type: 'number' }
      },
      required: ['input']
    }
  }
}

registerTextureComputation('kde', new KdeComputation())
