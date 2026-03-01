import { registerTextureComputation, TextureComputation, EXPRESSION_REF } from "./ComputationRegistry.js"
import makeHistogram from "./hist.js"

// Texture computation that filters the input data by a filter axis range and
// then builds a histogram texture from the surviving values.
//
// params:
//   input        — Float32Array of values normalised to [0, 1] (for histogram bins)
//   filterValues — Float32Array of raw filter-column values (same length as input)
//   filterAxisId — string: axis ID / quantity kind whose domain drives the filter
//   bins         — optional number of histogram bins
//
// getAxisDomain(filterAxisId) returns [min|null, max|null] where null means
// unbounded.  The computation is re-run automatically whenever the domain changes.
class FilteredHistogramComputation extends TextureComputation {
  compute(regl, params, getAxisDomain) {
    const { input, filterValues, filterAxisId, bins } = params
    const domain = getAxisDomain(filterAxisId)   // [min|null, max|null] or null
    const filterMin = domain?.[0] ?? null
    const filterMax = domain?.[1] ?? null

    // Build a compact array of the normalised values that pass the filter.
    const filtered = []
    for (let i = 0; i < input.length; i++) {
      const fv = filterValues[i]
      if (filterMin !== null && fv < filterMin) continue
      if (filterMax !== null && fv > filterMax) continue
      filtered.push(input[i])
    }

    return makeHistogram(regl, new Float32Array(filtered), { bins })
  }
  schema(data) {
    return {
      type: 'object',
      properties: {
        input: EXPRESSION_REF,
        filterValues: EXPRESSION_REF,
        filterAxisId: { type: 'string' },
        bins: { type: 'number' }
      },
      required: ['input', 'filterValues', 'filterAxisId']
    }
  }
}

registerTextureComputation('filteredHistogram', new FilteredHistogramComputation())
