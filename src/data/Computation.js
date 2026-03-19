import { ColumnData, TextureColumn, GlslColumn } from './ColumnData.js'

function domainsEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

// ─── Base classes ─────────────────────────────────────────────────────────────
export class Computation {
  schema(data) { throw new Error('Not implemented') }
  getQuantityKind(params, data) { return null }
}

export class ComputedData {
  columns() { throw new Error('Not implemented') }
  compute(regl, params, data, getAxisDomain) { throw new Error('Not implemented') }
  schema(data) { throw new Error('Not implemented') }
  filterAxes(params, data) { return {} }
}

export class TextureComputation extends Computation {
  // Override: inputs is { name: ColumnData | scalar }, returns raw regl texture.
  compute(regl, inputs, getAxisDomain) { throw new Error('Not implemented') }

  // Override to declare output shape in JS without running GPU work.
  // Return int[] (e.g. [W, H] for a 2D output), or null to fall back to 1D (_dataLength).
  // inputs values are ColumnData (shapes accessible) or scalars.
  outputShape(inputs) { return null }

  createColumn(regl, inputs, plot) {
    const accessedAxes = new Set()
    const cachedDomains = {}

    const getAxisDomain = (axisId) => {
      accessedAxes.add(axisId)
      return plot ? plot.getAxisDomain(axisId) : null
    }

    const rawTex = this.compute(regl, inputs, getAxisDomain)
    const ref = { texture: rawTex }

    const hasColumnInputs = Object.values(inputs).some(v => v instanceof ColumnData)
    let refreshFn = null
    if (accessedAxes.size > 0 || hasColumnInputs) {
      for (const axisId of accessedAxes) {
        cachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
      }

      const comp = this
      refreshFn = (currentPlot, texRef) => {
        // Refresh inputs first; track if any updated
        let inputsRefreshed = false
        for (const val of Object.values(inputs)) {
          if (val instanceof ColumnData && val.refresh(currentPlot)) inputsRefreshed = true
        }

        let ownAxisChanged = false
        for (const axisId of accessedAxes) {
          if (!domainsEqual(currentPlot.getAxisDomain(axisId), cachedDomains[axisId])) {
            ownAxisChanged = true
            break
          }
        }

        if (!inputsRefreshed && !ownAxisChanged) return false

        const newAxes = new Set()
        const newGetter = (axisId) => { newAxes.add(axisId); return currentPlot.getAxisDomain(axisId) }
        texRef.texture = comp.compute(regl, inputs, newGetter)

        accessedAxes.clear()
        for (const axisId of newAxes) {
          accessedAxes.add(axisId)
          cachedDomains[axisId] = currentPlot.getAxisDomain(axisId)
        }
        return true
      }
    }

    return new TextureColumn(ref, {
      length: rawTex._dataLength ?? rawTex.width,
      shape: rawTex._dataShape ?? this.outputShape(inputs) ?? null,
      refreshFn
    })
  }
}

export class GlslComputation extends Computation {
  glsl(resolvedExprs) { throw new Error('Not implemented') }

  createColumn(inputs, meta = {}) {
    return new GlslColumn(inputs, resolvedExprs => this.glsl(resolvedExprs), meta)
  }
}
