/**
 * An Axis represents a single data axis on a plot. Axis instances are stable across
 * plot.update() calls and can be linked together with linkAxes().
 *
 * Public interface (duck-typing compatible):
 *   - axis.quantityKind   — string | null
 *   - axis.getDomain()    — [min, max] | null
 *   - axis.setDomain(domain) — update domain, schedule render, notify subscribers
 *   - axis.subscribe(callback)   — callback([min, max]) called on domain changes
 *   - axis.unsubscribe(callback) — remove a previously added callback
 */
export class Axis {
  constructor(plot, name) {
    this._plot = plot
    this._name = name
    this._listeners = new Set()
    this._propagating = false
  }

  /** The quantity kind for this axis, or null if the plot hasn't been initialized yet. */
  get quantityKind() { return this._plot.getAxisQuantityKind(this._name) }

  /** Returns [min, max], or null if the axis has no domain yet. */
  getDomain() { return this._plot.getAxisDomain(this._name) }

  /**
   * Sets the axis domain, schedules a render on the owning plot, and notifies all
   * subscribers (e.g. linked axes). A _propagating guard prevents infinite loops
   * when axes are linked bidirectionally.
   */
  setDomain(domain) {
    if (this._propagating) return
    this._propagating = true
    try {
      this._plot.setAxisDomain(this._name, domain)
      this._plot.scheduleRender()
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  /** Add a subscriber. callback([min, max]) is called after every setDomain(). */
  subscribe(callback) { this._listeners.add(callback) }

  /** Remove a previously added subscriber. */
  unsubscribe(callback) { this._listeners.delete(callback) }
}
