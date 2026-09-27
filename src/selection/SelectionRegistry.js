import { SelectionColumn } from "./SelectionColumn.js"

export class SelectionRegistry {
  constructor() {
    // dataRef → Map<name, { column: SelectionColumn, consumers: Set<Plot> }>
    this._entries = new WeakMap()
  }

  register(dataRef, name, plot, regl, tileSizes) {
    if (!this._entries.has(dataRef)) this._entries.set(dataRef, new Map())
    const byName = this._entries.get(dataRef)
    if (!byName.has(name)) {
      const col = new SelectionColumn(regl, tileSizes)
      const entry = { column: col, consumers: new Set() }
      col._onWrite = () => {
        for (const p of entry.consumers) p.scheduleRender()
      }
      byName.set(name, entry)
    }
    const entry = byName.get(name)
    entry.consumers.add(plot)
    return entry.column
  }

  get(dataRef, name, plot) {
    return this._entries.get(dataRef)?.get(name)?.column ?? null
  }

  unregister(dataRef, name, plot) {
    const byName = this._entries.get(dataRef)
    const entry = byName?.get(name)
    if (!entry) return
    entry.consumers.delete(plot)
    if (entry.consumers.size === 0) {
      entry.column.destroy()
      byName.delete(name)
    }
  }
}

export const globalSelectionRegistry = new SelectionRegistry()
