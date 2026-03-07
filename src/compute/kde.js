import { registerTextureComputation, TextureComputation, EXPRESSION_REF } from "./ComputationRegistry.js"

/**
 * Smooth a histogram to produce a KDE texture
 * @param {regl} regl - regl context
 * @param {Texture} histTex - histogram texture (values in R channel, width=bins, height=1)
 * @param {Object} options
 *   - bandwidth: Gaussian sigma in bins (default 5)
 *   - bins: output bins (default same as input)
 * @returns {Texture} - smoothed KDE texture
 */
export default function smoothKDE(regl, histTex, options = {}) {
  const bins = options.bins || histTex.width
  const bandwidth = options.bandwidth || 5.0

  const kdeTex = regl.texture({ width: bins, height: 1, type: 'float', format: 'rgba' })
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

  const kernelData = new Float32Array(kernelSize * 4)
  for (let i = 0; i < kernelSize; i++) kernelData[i * 4] = kernel[i]
  const kernelTex = regl.texture({ data: kernelData, shape: [kernelSize, 1], type: 'float', format: 'rgba' })

  const drawKDE = regl({
    framebuffer: kdeFBO,
    vert: `#version 300 es
      precision highp float;
      in float bin;
      void main() {
        float x = (bin + 0.5)/${bins}.0*2.0 - 1.0;
        gl_Position = vec4(x, 0.0, 0.0, 1.0);
      }
    `,
    frag: `#version 300 es
      precision highp float;
      uniform sampler2D histTex;
      uniform sampler2D kernelTex;
      uniform int kernelRadius;
      uniform int bins;
      out vec4 fragColor;
      void main() {
        float idx = gl_FragCoord.x - 0.5;
        float sum = 0.0;
        for (int i=-16; i<=16; i++) {
          if (i+16 >= kernelRadius*2+1) break;
          int sampleIdx = int(clamp(idx + float(i), 0.0, float(bins-1)));
          float h = texelFetch(histTex, ivec2(sampleIdx,0),0).r;
          float w = texelFetch(kernelTex, ivec2(i+kernelRadius,0),0).r;
          sum += h * w;
        }
        fragColor = vec4(sum, 0.0, 0.0, 1.0);
      }
    `,
    attributes: {
      bin: Array.from({ length: bins }, (_, i) => i)
    },
    uniforms: {
      histTex,
      kernelTex,
      kernelRadius,
      bins
    },
    count: bins,
    primitive: 'points'
  })

  drawKDE()

  return kdeTex
}

class KdeComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    const inputTex = inputs.input.toTexture(regl)
    return smoothKDE(regl, inputTex, { bins: inputs.bins, bandwidth: inputs.bandwidth })
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
