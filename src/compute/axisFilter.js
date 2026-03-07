import { registerTextureComputation, TextureComputation, EXPRESSION_REF, ArrayColumn, uploadToTexture } from "./ComputationRegistry.js"
import makeHistogram from "./hist.js"

// Texture computation that filters the input data by a filter axis range and
// then builds a histogram texture from the surviving values.
//
// params:
//   input        — ColumnData of values normalised to [0, 1] (for histogram bins); must be ArrayColumn
//   filterValues — ColumnData of raw filter-column values (same length as input); must be ArrayColumn
//   filterAxisId — string: axis ID / quantity kind whose domain drives the filter
//   bins         — optional number of histogram bins
//
// getAxisDomain(filterAxisId) returns [min|null, max|null] where null means
// unbounded.  The computation is re-run automatically whenever the domain changes.
class FilteredHistogramComputation extends TextureComputation {
  compute(regl, inputs, getAxisDomain) {
    const inputCol = inputs.input
    const filterCol = inputs.filterValues
    if (!(inputCol instanceof ArrayColumn)) throw new Error('filteredHistogram: input must be ArrayColumn')
    if (!(filterCol instanceof ArrayColumn)) throw new Error('filteredHistogram: filterValues must be ArrayColumn')

    const inputArr = inputCol.array
    const filterArr = filterCol.array
    const { filterAxisId, bins } = inputs
    const domain = getAxisDomain(filterAxisId)   // [min|null, max|null] or null
    const filterMin = domain?.[0] ?? null
    const filterMax = domain?.[1] ?? null

    // Build a compact array of the normalised values that pass the filter.
    const filtered = []
    for (let i = 0; i < inputArr.length; i++) {
      const fv = filterArr[i]
      if (filterMin !== null && fv < filterMin) continue
      if (filterMax !== null && fv > filterMax) continue
      filtered.push(inputArr[i])
    }

    const filteredTex = uploadToTexture(regl, new Float32Array(filtered))
    return makeHistogram(regl, filteredTex, { bins })
  }

  schema(data) {
    return {
      type: 'object',
      title: 'filteredHistogram',
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
