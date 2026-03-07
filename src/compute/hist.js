import {
  registerTextureComputation, TextureComputation, EXPRESSION_REF,
  ComputedData, registerComputedData, ArrayColumn, uploadToTexture, SAMPLE_COLUMN_GLSL
} from "./ComputationRegistry.js"

function autoBinsScott(data, options = {}) {
  const N = data.length
  const sampleCutoff = options.sampleCutoff || 50000
  let sampleData
  if (N > sampleCutoff) {
    sampleData = new Float32Array(sampleCutoff)
    for (let i = 0; i < sampleCutoff; i++) {
      sampleData[i] = data[Math.floor(Math.random() * N)]
    }
  } else {
    sampleData = data
  }
  const n = sampleData.length
  const mean = sampleData.reduce((a, b) => a + b, 0) / n
  let std
  if (N <= sampleCutoff) {
    std = Math.sqrt(sampleData.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  } else {
    std = Math.sqrt(sampleData.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  }
  const binWidth = 3.5 * std / Math.cbrt(N)
  let min = data[0], max = data[0]
  for (let i = 1; i < data.length; i++) {
    if (data[i] < min) min = data[i]
    if (data[i] > max) max = data[i]
  }
  return Math.max(1, Math.ceil((max - min) / binWidth))
}

function autoBins(data, options = {}) {
  const N = data.length
  const maxBins = options.maxBins || 2048
  if (N < 30) return Math.min(Math.ceil(Math.log2(N) + 1), maxBins)
  return autoBinsScott(data, options)
}

// Build a histogram texture from a regl texture (values in R channel).
// Assumes input values are already normalized to [0, 1].
// Returns a regl texture: width=bins, height=1, counts in R channel.
export default function makeHistogram(regl, inputTex, options = {}) {
  const N = inputTex._dataLength ?? inputTex.width * inputTex.height
  const bins = options.bins || 1024

  const histTex = regl.texture({ width: bins, height: 1, type: 'float', format: 'rgba' })
  const histFBO = regl.framebuffer({ color: histTex, depth: false, stencil: false })
  regl.clear({ color: [0, 0, 0, 0], framebuffer: histFBO })

  const pickIds = new Float32Array(N)
  for (let i = 0; i < N; i++) pickIds[i] = i

  const drawPoints = regl({
    framebuffer: histFBO,
    blend: { enable: true, func: { src: 'one', dst: 'one' } },
    vert: `#version 300 es
precision highp float;
precision highp sampler2D;
in float a_pickId;
uniform sampler2D u_inputTex;
${SAMPLE_COLUMN_GLSL}
void main() {
  float value = sampleColumn(u_inputTex, a_pickId);
  float x = (floor(value * ${bins}.0) + 0.5) / ${bins}.0 * 2.0 - 1.0;
  gl_Position = vec4(x, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`,
    frag: `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }`,
    attributes: { a_pickId: pickIds },
    uniforms: { u_inputTex: inputTex },
    count: N,
    primitive: 'points'
  })

  drawPoints()
  return histTex
}

// ─── HistogramComputation (TextureComputation — inline expression usage) ──────
class HistogramComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    const inputCol = inputs.input  // ColumnData

    let bins = inputs.bins
    if (!bins && inputCol instanceof ArrayColumn) {
      bins = autoBins(inputCol.array, { maxBins: inputs.maxBins || 2048 })
    } else if (!bins) {
      bins = inputs.maxBins || 1024
    }

    // Normalize to [0,1] for GPU histogram
    let normalizedTex
    if (inputCol instanceof ArrayColumn) {
      const arr = inputCol.array
      let min = arr[0], max = arr[0]
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] < min) min = arr[i]
        if (arr[i] > max) max = arr[i]
      }
      const range = max - min || 1
      const normalized = new Float32Array(arr.length)
      for (let i = 0; i < arr.length; i++) normalized[i] = (arr[i] - min) / range
      normalizedTex = uploadToTexture(regl, normalized)
    } else {
      // Already a GPU texture — assume values are in [0,1]
      normalizedTex = inputCol.toTexture(regl)
    }

    return makeHistogram(regl, normalizedTex, { bins })
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

// ─── HistogramData (ComputedData — top-level transform) ───────────────────────
class HistogramData extends ComputedData {
  columns() { return ['binCenters', 'counts'] }

  compute(regl, params, data, getAxisDomain) {
    const srcCol = data.getData(params.input)
    if (!(srcCol instanceof ArrayColumn)) {
      throw new Error(`HistogramData: input '${params.input}' must be a plain data column`)
    }
    const srcV = srcCol.array

    let min = Infinity, max = -Infinity
    for (let i = 0; i < srcV.length; i++) {
      if (srcV[i] < min) min = srcV[i]
      if (srcV[i] > max) max = srcV[i]
    }
    const range = max - min || 1

    const bins = params.bins || Math.max(10, Math.min(200, Math.ceil(Math.sqrt(srcV.length))))
    const binWidth = range / bins

    const normalized = new Float32Array(srcV.length)
    for (let i = 0; i < srcV.length; i++) normalized[i] = (srcV[i] - min) / range

    const centersData = new Float32Array(bins * 4)
    for (let i = 0; i < bins; i++) centersData[i * 4] = min + (i + 0.5) * binWidth
    const binCentersTex = regl.texture({ data: centersData, shape: [bins, 1], type: 'float', format: 'rgba' })
    binCentersTex._dataLength = bins

    const normalizedTex = uploadToTexture(regl, normalized)
    const countsTex = makeHistogram(regl, normalizedTex, { bins })
    countsTex._dataLength = bins

    const histCpu = new Float32Array(bins)
    for (let i = 0; i < srcV.length; i++) {
      histCpu[Math.min(Math.floor(normalized[i] * bins), bins - 1)] += 1
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
        input: { type: 'string', enum: cols, description: 'Input data column' },
        bins: { type: 'integer', description: 'Number of bins (0 for auto)', default: 0 }
      },
      required: ['input']
    }
  }
}

registerComputedData('HistogramData', new HistogramData())
