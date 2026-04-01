import { registerTextureComputation, registerComputedData, EXPRESSION_REF, EXPRESSION_REF_OPT } from "./ComputationRegistry.js"
import { TextureComputation, ComputedData } from "../data/Computation.js"
import { ArrayColumn, uploadToTexture, SAMPLE_COLUMN_GLSL } from "../data/ColumnData.js"
import { tdrYield } from "../tdr.js"

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

// Build a histogram texture from a column texture (4 values per texel).
// Assumes input values are already normalized to [0, 1].
// Returns a 4-packed texture: bins values packed 4 per texel.
export default async function makeHistogram(regl, inputTex, options = {}) {
  const N = inputTex._dataLength ?? inputTex.width * inputTex.height * 4
  const bins = options.bins || 1024

  const nTexels = Math.ceil(bins / 4)
  const wTexels = Math.min(nTexels, regl.limits.maxTextureSize)
  const hTexels = Math.ceil(nTexels / wTexels)

  const histTex = regl.texture({ width: wTexels, height: hTexels, type: 'float', format: 'rgba' })
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
out float v_chan;
void main() {
  float value = sampleColumn(u_inputTex, a_pickId);
  int b = int(clamp(floor(value * float(${bins})), 0.0, float(${bins - 1})));
  int texelI = b / 4;
  int chan = b % 4;
  float tx = (float(texelI % ${wTexels}) + 0.5) / float(${wTexels}) * 2.0 - 1.0;
  float ty = (float(texelI / ${wTexels}) + 0.5) / float(${hTexels}) * 2.0 - 1.0;
  gl_Position = vec4(tx, ty, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_chan = float(chan);
}`,
    frag: `#version 300 es
precision highp float;
in float v_chan;
out vec4 fragColor;
void main() {
  int c = int(v_chan + 0.5);
  fragColor = vec4(float(c == 0), float(c == 1), float(c == 2), float(c == 3));
}`,
    attributes: { a_pickId: pickIds },
    uniforms: { u_inputTex: inputTex },
    count: N,
    primitive: 'points'
  })

  drawPoints()
  histTex._dataLength = bins
  await tdrYield()
  return histTex
}

// ─── HistogramComputation (TextureComputation — inline expression usage) ──────
class HistogramComputation extends TextureComputation {
  async compute(regl, inputs, getAxisDomain) {
    const inputCol = inputs.input  // ColumnData

    let bins = inputs.bins
    if (!bins && inputCol instanceof ArrayColumn) {
      bins = autoBins(inputCol.array, { maxBins: inputs.maxBins || 2048 })
    } else if (!bins) {
      bins = inputs.maxBins || 1024
    }

    // Normalize to [0,1] for GPU histogram (CPU work)
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
      normalizedTex = await inputCol.toTexture(regl)
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

  filterAxes(params, data) {
    if (!params.filter) return {}
    const qk = data ? (data.getQuantityKind(params.filter) ?? params.filter) : params.filter
    return { filter: qk }
  }

  async compute(regl, params, data, getAxisDomain) {
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

    // Normalize full input to [0,1] for bin assignment.
    const normalized = new Float32Array(srcV.length)
    for (let i = 0; i < srcV.length; i++) normalized[i] = (srcV[i] - min) / range

    // Build optional filter mask and track filter axis for axis-reactivity.
    let filterMask = null
    const filterDataExtents = {}
    if (params.filter) {
      const filterCol = data.getData(params.filter)
      if (!(filterCol instanceof ArrayColumn)) {
        throw new Error(`HistogramData: filter '${params.filter}' must be a plain data column`)
      }
      const filterArr = filterCol.array
      const filterQK = data.getQuantityKind(params.filter) ?? params.filter

      let fMin = filterArr[0], fMax = filterArr[0]
      for (let i = 1; i < filterArr.length; i++) {
        if (filterArr[i] < fMin) fMin = filterArr[i]
        if (filterArr[i] > fMax) fMax = filterArr[i]
      }
      filterDataExtents[filterQK] = [fMin, fMax]

      // Calling getAxisDomain registers the filter axis as an accessed axis so the
      // ComputedDataNode recomputes whenever the filter range changes.
      const domain = getAxisDomain(filterQK)
      const fRangeMin = domain?.[0] ?? null
      const fRangeMax = domain?.[1] ?? null

      if (fRangeMin !== null || fRangeMax !== null) {
        filterMask = new Uint8Array(srcV.length)
        for (let i = 0; i < filterArr.length; i++) {
          if (fRangeMin !== null && filterArr[i] < fRangeMin) continue
          if (fRangeMax !== null && filterArr[i] > fRangeMax) continue
          filterMask[i] = 1
        }
      }
    }

    // Bin centers always span the full input range so bars don't shift when filtering.
    const nTexels = Math.ceil(bins / 4)
    const centersW = Math.min(nTexels, regl.limits.maxTextureSize)
    const centersH = Math.ceil(nTexels / centersW)
    const centersData = new Float32Array(centersW * centersH * 4)
    for (let i = 0; i < bins; i++) centersData[i] = min + (i + 0.5) * binWidth
    const binCentersTex = regl.texture({ data: centersData, shape: [centersW, centersH], type: 'float', format: 'rgba' })
    binCentersTex._dataLength = bins

    // Build histogram from filtered (or full) normalized values.
    let countInput = normalized
    if (filterMask) {
      const filtered = []
      for (let i = 0; i < srcV.length; i++) {
        if (filterMask[i]) filtered.push(normalized[i])
      }
      countInput = new Float32Array(filtered)
    }
    const normalizedTex = uploadToTexture(regl, countInput)
    const countsTex = await makeHistogram(regl, normalizedTex, { bins })
    countsTex._dataLength = bins

    const histCpu = new Float32Array(bins)
    for (let i = 0; i < countInput.length; i++) {
      histCpu[Math.min(Math.floor(countInput[i] * bins), bins - 1)] += 1
    }
    const maxCount = Math.max(...histCpu, 0)

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
        filterDataExtents,
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
        bins: { type: 'integer', description: 'Number of bins (0 for auto)', default: 0 },
        filter: { ...EXPRESSION_REF_OPT, description: 'Filter column — registers a filter axis (null for none)' }
      },
      required: ['input', 'filter']
    }
  }
}

registerComputedData('HistogramData', new HistogramData())
