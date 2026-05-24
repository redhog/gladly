import { SelectionColumn } from "./SelectionColumn.js"

// SelectionEntry: one per (dataRef, name) pair
// { n: number, subscribers: Map<Plot, SelectionColumn> }

export class SelectionRegistry {
  constructor() {
    this._entries = new WeakMap()   // dataRef → Map<name, SelectionEntry>
  }

  _getOrCreateEntry(dataRef, name, n) {
    if (!this._entries.has(dataRef)) this._entries.set(dataRef, new Map())
    const byName = this._entries.get(dataRef)
    if (!byName.has(name)) {
      byName.set(name, { n, subscribers: new Map() })
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

  unregister(dataRef, name, plot) {
    const entry = this._entries.get(dataRef)?.get(name)
    if (!entry) return
    entry.subscribers.get(plot)?.destroy()
    entry.subscribers.delete(plot)
  }
}

export const globalSelectionRegistry = new SelectionRegistry()
