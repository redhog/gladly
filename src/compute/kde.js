/**
 * Smooth a histogram to produce a KDE texture
 * @param {regl} regl - regl context
 * @param {Float32Array | Texture} histInput - histogram data
 * @param {Object} options
 *   - bandwidth: Gaussian sigma in bins (default 5)
 *   - bins: output bins (default same as input)
 * @returns {Texture} - smoothed KDE texture
 */
export default function smoothKDE(regl, histInput, options = {}) {
  const bins = options.bins || (histInput instanceof Float32Array ? histInput.length : histInput.width);
  const bandwidth = options.bandwidth || 5.0;

  const histTex = (histInput instanceof Float32Array)
    ? regl.texture({ data: histInput, shape: [bins, 1], type: 'float' })
    : histInput;

  const kdeTex = regl.texture({ width: bins, height: 1, type: 'float', format: 'rgba' });
  const kdeFBO = regl.framebuffer({ color: kdeTex });

  const kernelRadius = Math.ceil(bandwidth * 3);
  const kernelSize = kernelRadius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = -kernelRadius; i <= kernelRadius; i++) {
    const w = Math.exp(-0.5 * (i / bandwidth) ** 2);
    kernel[i + kernelRadius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const kernelTex = regl.texture({ data: kernel, shape: [kernelSize, 1], type: 'float' });

  const drawKDE = regl({
    framebuffer: kdeFBO,
    vert: `
      precision highp float;
      attribute float bin;
      void main() {
        float x = (bin + 0.5)/${bins}.0*2.0 - 1.0;
        gl_Position = vec4(x, 0.0, 0.0, 1.0);
      }
    `,
    frag: `
      #version 300 es
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
  });

  drawKDE();

  return kdeTex;
}
