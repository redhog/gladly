import { ComputedData, registerComputedData, EXPRESSION_REF, resolveExprToColumn, ColumnData } from "./ComputationRegistry.js"

class ElementwiseData extends ComputedData {
  columns(params) {
    if (!params?.columns) return []
    return params.columns.map(c => c.dst)
  }

  compute(regl, params, data, getAxisDomain) {
    const plotProxy = { currentData: data, getAxisDomain }

    let N = params.dataLength ?? null
    if (N == null) {
      for (const { src } of params.columns) {
        const col = resolveExprToColumn(src, data, regl, plotProxy)
        if (col?.length !== null) { N = col.length; break }
      }
    }
    if (N == null) throw new Error('ElementwiseData: cannot determine data length; set dataLength param')

    const result = {}
    for (const { dst, src } of params.columns) {
      const col = resolveExprToColumn(src, data, regl, plotProxy)
      const tex = col.toTexture(regl)
      tex._dataLength = N
      result[dst] = tex
    }
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
              dst: { type: 'string', description: 'Output column name' },
              src: EXPRESSION_REF
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
