import { registerTextureComputation, TextureComputation, EXPRESSION_REF, ComputedData, registerComputedData } from "./ComputationRegistry.js"

/**
 * Auto-select number of histogram bins using Scott's rule.
 * For large datasets, uses a random subset to estimate std for speed.
 * @param {Float32Array | Array} data - input array
 * @param {Object} options
 *   - sampleCutoff: max points to use for std estimation (default 50000)
 * @returns {number} - suggested number of bins
 */
function autoBinsScott(data, options = {}) {
  const N = data.length;
  const sampleCutoff = options.sampleCutoff || 50000;

  let sampleData;

  if (N > sampleCutoff) {
    // Randomly sample sampleCutoff points
    sampleData = new Float32Array(sampleCutoff);
    for (let i = 0; i < sampleCutoff; i++) {
      const idx = Math.floor(Math.random() * N);
      sampleData[i] = data[idx];
    }
  } else {
    sampleData = data;
  }

  const n = sampleData.length;

  // Compute mean
  const mean = sampleData.reduce((a, b) => a + b, 0) / n;

  // Compute standard deviation
  let std;
  if (N <= sampleCutoff) {
    // small dataset: population std
    const variance = sampleData.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    std = Math.sqrt(variance);
  } else {
    // large dataset: sample std
    const variance = sampleData.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    std = Math.sqrt(variance);
  }

  // Compute bin width
  const binWidth = 3.5 * std / Math.cbrt(N);

  // Determine number of bins
  let min = data[0], max = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const bins = Math.max(1, Math.ceil((max - min) / binWidth));

  return bins;
}

/**
 * Automatically determine number of bins using Freedman–Diaconis or Sturges
 * @param {Float32Array} data - input array
 * @param {Object} options
 *   - maxBins: maximum bins allowed (GPU-friendly)
 * @returns {number} - number of bins
 */
function autoBins(data, options = {}) {
  const N = data.length;
  const maxBins = options.maxBins || 2048;

  if (N < 30) {
    // Small dataset → use Sturges
    return Math.min(Math.ceil(Math.log2(N) + 1), maxBins);
  }

  return autoBinsScott(data, options)
}

/**
 * Create a histogram texture from CPU array or GPU texture.
 * @param {regl} regl - regl context
 * @param {Float32Array | Texture} input - CPU array in [0,1] or GPU texture
 * @param {Object} options
 *   - bins: number of bins (optional, overrides auto)
 *   - useGPU: force GPU histogram
 *   - maxBins: max number of bins for auto calculation
 * @returns {Texture} - histogram texture
 */
export default function makeHistogram(regl, input, options = {}) {
  let bins = options.bins;
  const useGPU = options.useGPU || false;

  // Auto bins if not provided and input is CPU array
  if (!bins && input instanceof Float32Array) {
    bins = autoBins(input, { maxBins: options.maxBins || 2048 });
  } else if (!bins) {
    bins = options.maxBins || 1024; // default for GPU textures
  }

  // Allocate histogram texture and framebuffer
  const histTex = regl.texture({
    width: bins,
    height: 1,
    type: 'float',
    format: 'rgba'
  });
  const histFBO = regl.framebuffer({ color: histTex, depth: false, stencil: false });

  // Clear histogram
  regl.clear({ color: [0, 0, 0, 0], framebuffer: histFBO });

  if (input instanceof Float32Array && !useGPU) {
    // CPU histogram — pack counts into the R channel of each RGBA texel
    const histData = new Float32Array(bins);
    const N = input.length;
    for (let i = 0; i < N; i++) {
      const b = Math.floor(input[i] * bins);
      histData[Math.min(b, bins - 1)] += 1;
    }
    // RGBA format: 4 floats per texel. Store count in R, leave G/B/A as 0.
    const packedData = new Float32Array(bins * 4);
    for (let i = 0; i < bins; i++) packedData[i * 4] = histData[i];
    histTex.subimage({ data: packedData, width: bins, height: 1 });

  } else {
    // GPU histogram
    const dataTex = (input instanceof Float32Array)
      ? regl.texture({ data: input, shape: [input.length, 1], type: 'float' })
      : input;

    const N = (input instanceof Float32Array) ? input.length : dataTex.width;

    const drawPoints = regl({
      framebuffer: histFBO,
      blend: { enable: true, func: { src: 'one', dst: 'one' } },
      vert: `#version 300 es
        precision highp float;
        in float value;
        void main() {
          float x = (floor(value * ${bins}.0) + 0.5)/${bins}.0*2.0 - 1.0;
          gl_Position = vec4(x, 0.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }
      `,
      frag: `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }
      `,
      attributes: {
        value: () => (input instanceof Float32Array)
          ? input
          : Array.from({ length: N }, (_, i) => i / (N - 1))
      },
      count: N,
      primitive: 'points'
    });

    drawPoints();
  }

  return histTex;
}

class HistogramComputation extends TextureComputation {
  compute(regl, params, data, getAxisDomain) {
    const input = this.resolveDataParam(regl, data, params.input)
    return makeHistogram(regl, input, { bins: params.bins })
  }
  schema(data) {
    return {
      type: 'object',
      title: 'histogram',
      properties: {
        input: EXPRESSION_REF,
        bins: { type: 'number' }
      },
      required: ['input']
    }
  }
}

registerTextureComputation('histogram', new HistogramComputation())

// ComputedData transform that produces binCenters + counts textures from a raw data column.
class HistogramData extends ComputedData {
  columns() { return ['binCenters', 'counts'] }

  compute(regl, params, data, getAxisDomain) {
    const srcV = this.resolveDataParam(data, params.input)
    if (!srcV) throw new Error(`HistogramData: cannot resolve input '${params.input}'`)

    let min = Infinity, max = -Infinity
    for (let i = 0; i < srcV.length; i++) {
      if (srcV[i] < min) min = srcV[i]
      if (srcV[i] > max) max = srcV[i]
    }
    const range = max - min || 1

    const bins = params.bins || Math.max(10, Math.min(200, Math.ceil(Math.sqrt(srcV.length))))
    const binWidth = range / bins

    const normalized = new Float32Array(srcV.length)
    for (let i = 0; i < srcV.length; i++) {
      normalized[i] = (srcV[i] - min) / range
    }

    // binCenters texture: width=bins, texel i stores [binCenter_i, 0, 0, 0]
    const centersData = new Float32Array(bins * 4)
    for (let i = 0; i < bins; i++) {
      centersData[i * 4] = min + (i + 0.5) * binWidth
    }
    const binCentersTex = regl.texture({ data: centersData, shape: [bins, 1], type: 'float', format: 'rgba' })

    const countsTex = makeHistogram(regl, normalized, { bins })

    // CPU pass to find maxCount for y-axis domain
    const histCpu = new Float32Array(bins)
    for (let i = 0; i < srcV.length; i++) {
      const b = Math.min(Math.floor(normalized[i] * bins), bins - 1)
      histCpu[b] += 1
    }
    const maxCount = Math.max(...histCpu)

    const xQK = (typeof params.input === 'string' && data)
      ? (data.getQuantityKind(params.input) ?? params.input)
      : null

    return {
      binCenters: binCentersTex,
      counts: countsTex,
      _meta: {
        domains: {
          binCenters: [min, max],
          counts: [0, maxCount],
        },
        quantityKinds: {
          binCenters: xQK,
          counts: 'count',
        },
        binHalfWidth: binWidth / 2,
      }
    }
  }

  schema(data) {
    const cols = data ? data.columns() : []
    return {
      type: 'object',
      title: 'HistogramData',
      properties: {
        input: {
          type: 'string',
          enum: cols,
          description: 'Input data column'
        },
        bins: {
          type: 'integer',
          description: 'Number of bins (0 for auto)',
          default: 0
        }
      },
      required: ['input']
    }
  }
}

registerComputedData('HistogramData', new HistogramData())
