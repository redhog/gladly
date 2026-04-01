import { registerComputedData, EXPRESSION_REF, resolveExprToColumn } from "./ComputationRegistry.js"
import { ComputedData } from "../data/Computation.js"

class ElementwiseData extends ComputedData {
  columns(params) {
    if (!params?.columns) return []
    return params.columns.map(c => c.dst)
  }

  async compute(regl, params, data, getAxisDomain) {
    const plotProxy = { currentData: data, getAxisDomain }

    let N = params.dataLength ?? null
    if (N == null) {
      for (const { src } of params.columns) {
        const col = await resolveExprToColumn(src, data, regl, plotProxy)
        if (col?.length !== null) { N = col.length; break }
      }
    }
    if (N == null) throw new Error('ElementwiseData: cannot determine data length; set dataLength param')

    const result = {}
    const quantityKinds = {}

    for (const { dst, src, quantityKind } of params.columns) {
      const col = await resolveExprToColumn(src, data, regl, plotProxy)
      const tex = await col.toTexture(regl)
      tex._dataLength = N
      result[dst] = tex
      if (quantityKind) quantityKinds[dst] = quantityKind
    }

    if (Object.keys(quantityKinds).length > 0) result._meta = { quantityKinds }
    return result
  }

  schema(data) {
    return {
      type: 'object',
      title: 'ElementwiseData',
      properties: {
        dataLength: {
          type: 'integer',
          description: 'Override output length (optional, auto-detected from column refs)'
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dst:          { type: 'string', description: 'Output column name' },
              src:          EXPRESSION_REF,
              quantityKind: { type: 'string', description: 'Quantity kind for axis matching (optional)' }
            },
            required: ['dst', 'src']
          }
        }
      },
      required: ['columns']
    }
  }
}

registerComputedData('ElementwiseData', new ElementwiseData())
