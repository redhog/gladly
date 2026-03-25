import { registerComputedData, EXPRESSION_REF, resolveExprToColumn } from "./ComputationRegistry.js"
import { ComputedData } from "../data/Computation.js"

const TDR_STEP_MS = 500

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
    let stepStart = performance.now()

    for (const { dst, src, quantityKind } of params.columns) {
      const col = await resolveExprToColumn(src, data, regl, plotProxy)
      const tex = col.toTexture(regl)
      tex._dataLength = N
      result[dst] = tex
      if (quantityKind) quantityKinds[dst] = quantityKind

      if (performance.now() - stepStart > TDR_STEP_MS) {
        await new Promise(r => requestAnimationFrame(r))
        stepStart = performance.now()
      }
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
