import { AXES } from "../axes/AxisRegistry.js"
import { linkAxes } from "../axes/AxisLink.js"
import { normalizeData } from "../data/Data.js"

/**
 * Coordinates a set of named Plot instances.
 *
 * - update({ data, plots }) normalizes data once so all plots share the same
 *   DataGroup, and updates all plots before re-establishing any auto-links,
 *   so intermediate QK mismatches never reach linkAxes().
 *
 * - When autoLink is true, all axes across all plots that share the same
 *   quantity kind are automatically linked. Axes that no longer share a QK
 *   after an update are simply unlinked rather than throwing.
 *
 * - When autoLink is false, manual links created via linkAxes() on axes
 *   belonging to plots in the group survive PlotGroup.update() calls
 *   unchanged (Axis instances are stable across plot updates).
 */
export class PlotGroup {
  constructor(plots = {}, { autoLink = false } = {}) {
    this._plots = new Map()
    this._autoLink = autoLink
    // key → { unlink, plotA, plotB }
    this._links = new Map()

    for (const [name, plot] of Object.entries(plots)) {
      this._plots.set(name, plot)
      plot._group = this
    }

    if (autoLink) this._updateAutoLinks()
  }

  /** Add a named plot to the group. Re-runs auto-linking if enabled. */
  add(name, plot) {
    this._plots.set(name, plot)
    plot._group = this
    if (this._autoLink) this._updateAutoLinks()
  }

  /** Remove a named plot from the group, tearing down any links involving it. */
  remove(name) {
    if (!this._plots.has(name)) return
    this._removeLinksForPlot(name)
    const plot = this._plots.get(name)
    if (plot._group === this) plot._group = null
    this._plots.delete(name)
  }

  /**
   * Update plots in the group.
   *
   * @param {object} options
   * @param {*}      [options.data]   - Raw data passed to all plots (normalized once).
   * @param {object} [options.plots]  - Map of { plotName: plotConfig } to update individually.
   */
  async update({ data, plots } = {}) {
    // Normalize data once so every plot receives the same DataGroup instance.
    const normalizedData = data !== undefined ? normalizeData(data) : undefined

    // Drop auto-links before updating any plot so intermediate states (one plot
    // updated, the other not yet) don't trigger false QK mismatch errors.
    if (this._autoLink) {
      for (const entry of this._links.values()) entry.unlink()
      this._links.clear()
    }

    // Collect which plots will actually be updated, and snapshot their state
    // so we can roll all of them back atomically if validation fails.
    const toUpdate = []
    for (const [name, plot] of this._plots) {
      const plotConfig = plots?.[name]
      if (normalizedData === undefined && plotConfig === undefined) continue
      toUpdate.push({ name, plot, prevConfig: plot.currentConfig, prevRawData: plot._rawData })
    }

    try {
      // Phase 1: apply all updates (no link validation yet).
      for (const { name, plot } of toUpdate) {
        const arg = {}
        if (normalizedData !== undefined) arg.data = normalizedData
        if (plots?.[name] !== undefined) arg.config = plots[name]
        await plot._applyUpdate(arg)
      }

      // Phase 2: validate links across every plot now that all QKs are final.
      for (const [, plot] of this._plots) plot._validateLinks()

      // Phase 3: reconcile auto-links with the new QKs in place.
      if (this._autoLink) this._updateAutoLinks()

    } catch (error) {
      // Roll back every plot that was updated.
      for (const { plot, prevConfig, prevRawData } of toUpdate) {
        plot.currentConfig = prevConfig
        plot._rawData = prevRawData
        try { await plot._applyUpdate({}) } catch (e) {
          console.error('[gladly] PlotGroup: error during rollback re-render:', e)
        }
      }
      // Restore auto-links to match the rolled-back state.
      if (this._autoLink) this._updateAutoLinks()
      throw error
    }
  }

  /** Tear down all auto-managed links. Does not destroy the plots themselves. */
  destroy() {
    for (const entry of this._links.values()) entry.unlink()
    this._links.clear()
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _updateAutoLinks() {
    // Collect all axes grouped by quantity kind across all plots.
    // Spatial, color, and filter axes are all handled uniformly:
    // plot._getAxis(id) returns a stable Axis instance for any id.
    const qkAxes = new Map() // QK → [{ plotName, axisId }]

    for (const [plotName, plot] of this._plots) {
      // Spatial axes
      if (plot.axisRegistry) {
        for (const axisId of AXES) {
          const qk = plot.getAxisQuantityKind(axisId)
          if (!qk) continue
          _push(qkAxes, qk, { plotName, axisId })
        }
      }

      // Color and filter axes (axisId === quantityKind for non-spatial axes)
      if (plot.axisRegistry) {
        for (const qk of plot.axisRegistry.getQuantityKinds()) {
          if (plot.axisRegistry.hasColorAxis(qk) || plot.axisRegistry.hasFilterAxis(qk)) {
            _push(qkAxes, qk, { plotName, axisId: qk })
          }
        }
      }
    }

    // Determine which links should exist.
    const desiredKeys = new Set()
    for (const entries of qkAxes.values()) {
      if (entries.length < 2) continue
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          desiredKeys.add(_linkKey(entries[i], entries[j]))
        }
      }
    }

    // Remove stale links.
    for (const [key, entry] of this._links) {
      if (!desiredKeys.has(key)) {
        entry.unlink()
        this._links.delete(key)
      }
    }

    // Create missing links.
    for (const [, entries] of qkAxes) {
      if (entries.length < 2) continue
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i], b = entries[j]
          const key = _linkKey(a, b)
          if (this._links.has(key)) continue

          const axisA = this._plots.get(a.plotName)._getAxis(a.axisId)
          const axisB = this._plots.get(b.plotName)._getAxis(b.axisId)
          // Both axes share the same QK (guaranteed by qkAxes grouping),
          // so linkAxes() will not throw.
          const handle = linkAxes(axisA, axisB)
          this._links.set(key, { unlink: handle.unlink, plotA: a.plotName, plotB: b.plotName })
        }
      }
    }
  }

  _removeLinksForPlot(name) {
    for (const [key, entry] of this._links) {
      if (entry.plotA === name || entry.plotB === name) {
        entry.unlink()
        this._links.delete(key)
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _push(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}

/** Canonical link key — lexicographically sorted so (A,B) === (B,A). */
function _linkKey(a, b) {
  const ka = `${a.plotName}\0${a.axisId}`
  const kb = `${b.plotName}\0${b.axisId}`
  return ka < kb ? `${ka}--${kb}` : `${kb}--${ka}`
}
