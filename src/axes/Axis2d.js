import { Plot } from "../core/Plot.js"

// A Proxy `get` trap only ever receives a string key, so the ordered
// (xAxisQk, yAxisQk) pair is encoded as a single string. `__` is reserved as the
// separator and rejected in quantity-kind names (see registerAxisQuantityKind), so
// it cannot collide with a name; being made of legal JS identifier characters it
// also permits dot access: plot.axis2d.velocity_ms__density (= plot.axis2d["..."]).
const KEY_SEPARATOR = "__"

/**
 * A first-class handle for a 2D colour pairing — what Axis is to a single axis.
 *
 * A pairing fuses two colour axes (x and y, order matters) into a single 2D
 * colorscale. Its config *is* the pair's entry inside the plot's `colorbars` config
 * array; there is no separate state. Access via `plot.axis2d["<qkX>__<qkY>"]`.
 */
export class Axis2d {
  // Encode an ordered pair of quantity kinds into an axis2d key.
  static makeKey(xAxisQk, yAxisQk) {
    return `${xAxisQk}${KEY_SEPARATOR}${yAxisQk}`
  }

  // Split an axis2d key back into { xAxis, yAxis } (on the first separator, so the
  // x role — which never contains the separator — is recovered unambiguously).
  static splitKey(key) {
    const i = key.indexOf(KEY_SEPARATOR)
    if (i < 0) return [key, undefined]
    return [key.slice(0, i), key.slice(i + KEY_SEPARATOR.length)]
  }

  // The colorbars-item JSON Schema fragment (with the `enabled`/`colorbar` keys).
  static schema(data, config) {
    return Plot.schema(data, config).properties.colorbars.items
  }

  constructor(plot, xAxis, yAxis) {
    this._plot = plot
    this.xAxis = xAxis   // x-role quantity kind
    this.yAxis = yAxis   // y-role quantity kind
  }

  _matches(entry) {
    return entry.xAxis === this.xAxis && entry.yAxis === this.yAxis
  }

  // Defined as the pair's entry inside plot.getConfig().colorbars — the same object
  // that round-trips through getConfig(). `{}` when no entry exists yet (which, like
  // enabled:false, means "colour from each axis's own colorscale").
  getConfig() {
    const colorbars = this._plot.getConfig().colorbars ?? []
    return colorbars.find(e => this._matches(e)) ?? {}
  }

  // Find-or-create the pair's colorbars entry (matched on the ordered pair), write
  // cfg into it, and re-apply through the plot's config path. Canonicalises on the
  // pair, so duplicate entries collapse to one.
  async setConfig(cfg) {
    const config = this._plot.currentConfig ?? {}
    const colorbars = config.colorbars ?? []
    const idx = colorbars.findIndex(e => this._matches(e))

    let next
    if (idx < 0) {
      next = [...colorbars, { ...cfg, xAxis: this.xAxis, yAxis: this.yAxis }]
    } else {
      next = colorbars
        .map((e, i) => i === idx ? { ...e, ...cfg, xAxis: this.xAxis, yAxis: this.yAxis } : e)
        .filter((e, i) => i === idx || !this._matches(e))
    }

    await this._plot.update({ config: { ...config, colorbars: next } })
  }
}
