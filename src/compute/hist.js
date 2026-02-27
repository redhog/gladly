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
  const min = Math.min(...data);
  const max = Math.max(...data);
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
  const histFBO = regl.framebuffer({ color: histTex });

  // Clear histogram
  regl({ framebuffer: histFBO, clearColor: [0, 0, 0, 0] })(() => {});

  if (input instanceof Float32Array && !useGPU) {
    // CPU histogram
    const histData = new Float32Array(bins);
    const N = input.length;
    for (let i = 0; i < N; i++) {
      const b = Math.floor(input[i] * bins);
      histData[Math.min(b, bins - 1)] += 1;
    }
    histTex.subimage({ data: histData, width: bins, height: 1 });

  } else {
    // GPU histogram
    const dataTex = (input instanceof Float32Array)
      ? regl.texture({ data: input, shape: [input.length, 1], type: 'float' })
      : input;

    const N = (input instanceof Float32Array) ? input.length : dataTex.width;

    const drawPoints = regl({
      framebuffer: histFBO,
      blend: { enable: true, func: { src: 'one', dst: 'one' } },
      vert: `
        precision highp float;
        attribute float value;
        void main() {
          float x = (floor(value * ${bins}.0) + 0.5)/${bins}.0*2.0 - 1.0;
          gl_Position = vec4(x, 0.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }
      `,
      frag: `
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
