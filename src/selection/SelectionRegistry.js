import { SelectionColumn } from "./SelectionColumn.js"

// SelectionEntry: one per (dataRef, name) pair
// {
//   n:           number,
//   data:        Float32Array,     CPU mirror, 4-packed 0/1 values
//   subscribers: Map<Plot, SelectionColumn>
// }

export class SelectionRegistry {
  constructor() {
    this._entries = new WeakMap()   // dataRef → Map<name, SelectionEntry>
  }

  _getOrCreateEntry(dataRef, name, n) {
    if (!this._entries.has(dataRef)) this._entries.set(dataRef, new Map())
    const byName = this._entries.get(dataRef)
    if (!byName.has(name)) {
      byName.set(name, {
        n,
        data: new Float32Array(Math.ceil(n / 4) * 4),
        subscribers: new Map(),
      })
    } else {
      const entry = byName.get(name)
      if (entry.n !== n) {
        console.warn(
          `[gladly] SelectionRegistry: selection "${name}" already registered with n=${entry.n}, ` +
          `but new subscriber has n=${n}. These layers do not share the same dataset — ` +
          `they will not be linked. Ensure both plots receive the same data object to link selections.`
        )
        return null
      }
    }
    return byName.get(name)
  }

  register(dataRef, name, plot, regl, n) {
    const entry = this._getOrCreateEntry(dataRef, name, n)
    if (!entry) return null

    if (!entry.subscribers.has(plot)) {
      const col = new SelectionColumn(regl, n)
      entry.subscribers.set(plot, col)
    }
    return entry.subscribers.get(plot)
  }

  get(dataRef, name, plot) {
    return this._entries.get(dataRef)?.get(name)?.subscribers.get(plot) ?? null
  }

  // Called after the GPU halving loop completes in sourcePlot.
  // Reads back sourcePlot's SelectionColumn to the CPU mirror, then uploads
  // to all other subscribers' GPU textures and schedules their re-renders.
  notifyFromGpu(dataRef, name, sourcePlot) {
    const entry = this._entries.get(dataRef)?.get(name)
    if (!entry) return

    const sourceCol = entry.subscribers.get(sourcePlot)
    if (!sourceCol) return

    // Readback from source GPU texture → CPU mirror
    const pixelCount = sourceCol.texW * sourceCol.texH * 4
    const floatData = new Float32Array(pixelCount)
    sourcePlot.regl({ framebuffer: sourceCol.fbo })(() => {
      sourcePlot.regl.read({ data: floatData })
    })
    entry.data.set(floatData)

    // Upload CPU mirror to all other subscribers and schedule re-render
    for (const [plot, col] of entry.subscribers) {
      col.activate()
      if (plot === sourcePlot) {
        plot.scheduleRender()
        continue
      }
      col._ref.texture.subimage({ data: entry.data, width: col.texW, height: col.texH })
      plot.scheduleRender()
    }
  }

  unregister(dataRef, name, plot) {
    const entry = this._entries.get(dataRef)?.get(name)
    if (!entry) return
    entry.subscribers.get(plot)?.destroy()
    entry.subscribers.delete(plot)
  }
}

export const globalSelectionRegistry = new SelectionRegistry()
