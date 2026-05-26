import { SelectionColumn } from "./SelectionColumn.js"

export class SelectionRegistry {
  constructor() {
    this._entries = new WeakMap()   // dataRef → Map<name, { subscribers: Map<Plot, SelectionColumn> }>
  }

  register(dataRef, name, plot, regl, tileSizes) {
    if (!this._entries.has(dataRef)) this._entries.set(dataRef, new Map())
    const byName = this._entries.get(dataRef)
    if (!byName.has(name)) byName.set(name, { subscribers: new Map() })
    const entry = byName.get(name)
    if (!entry.subscribers.has(plot)) {
      entry.subscribers.set(plot, new SelectionColumn(regl, tileSizes))
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
