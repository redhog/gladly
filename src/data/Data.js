import { ArrayColumn, TextureColumn } from './ColumnData.js'

function domainsEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

// Runtime wrapper for a ComputedData instance. Manages live texture references
// and tracks which axes were accessed so it can recompute when they change.
export class ComputedDataNode {
  constructor(computedData, params) {
    this._computedData = computedData
    this._params = params
    this._liveRefs = {}   // { colName: { texture } }
    this._meta = null
    this._accessedAxes = new Set()
    this._cachedDomains = {}
    this._regl = null
    this._dataGroup = null
    this._version = 0
  }

  columns() {
    return this._computedData.columns(this._params)
  }

  getData(col) {
    const ref = this._liveRefs[col]
    if (!ref) return null
    const node = this
    let lastVersion = this._version
    return new TextureColumn(ref, {
      domain: this._meta?.domains?.[col] ?? null,
      quantityKind: this._meta?.quantityKinds?.[col] ?? null,
      length: ref.texture ? (ref.texture._dataLength ?? ref.texture.width) : null,
      refreshFn: (plot) => {
        node.refreshIfNeeded(plot)
        if (node._version !== lastVersion) {
          lastVersion = node._version
          return true
        }
        return false
      }
    })
  }

  getQuantityKind(col) {
    return this._meta?.quantityKinds?.[col] ?? null
  }

  getDomain(col) {
    return this._meta?.domains?.[col] ?? null
  }

  _initialize(regl, dataGroup, plot) {
    this._regl = regl
    this._dataGroup = dataGroup

    const getAxisDomain = (axisId) => {
      this._accessedAxes.add(axisId)
      return plot ? plot.getAxisDomain(axisId) : null
    }

    const result = this._computedData.compute(regl, this._params, dataGroup, getAxisDomain)
    this._meta = result._meta ?? null

    for (const [key, val] of Object.entries(result)) {
      if (key === '_meta') continue
      this._liveRefs[key] = { texture: val }
    }

    for (const axisId of this._accessedAxes) {
      this._cachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
    }
  }

  refreshIfNeeded(plot) {
    if (this._accessedAxes.size === 0) return

    let needsRecompute = false
    for (const axisId of this._accessedAxes) {
      if (!domainsEqual(plot.getAxisDomain(axisId), this._cachedDomains[axisId])) {
        needsRecompute = true
        break
      }
    }
    if (!needsRecompute) return

    const newAccessedAxes = new Set()
    const newCachedDomains = {}
    const getAxisDomain = (axisId) => {
      newAccessedAxes.add(axisId)
      return plot ? plot.getAxisDomain(axisId) : null
    }

    const result = this._computedData.compute(this._regl, this._params, this._dataGroup, getAxisDomain)
    this._meta = result._meta ?? null

    for (const [key, val] of Object.entries(result)) {
      if (key === '_meta') continue
      if (this._liveRefs[key]) {
        this._liveRefs[key].texture = val
      } else {
        this._liveRefs[key] = { texture: val }
      }
    }

    this._accessedAxes = newAccessedAxes
    for (const axisId of newAccessedAxes) {
      newCachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
    }
    this._cachedDomains = newCachedDomains
    this._version++
  }
}

export class DataGroup {
  constructor(raw) {
    this._children = {}
    for (const [key, value] of Object.entries(raw)) {
      this._children[key] = Data.wrap(value)
    }
  }

  listData() {
    const result = {}
    for (const [key, child] of Object.entries(this._children)) {
      if (child instanceof Data) result[key] = child
    }
    return result
  }

  subgroups() {
    const result = {}
    for (const [key, child] of Object.entries(this._children)) {
      if (child instanceof DataGroup) result[key] = child
    }
    return result
  }

  columns() {
    const cols = []
    for (const [key, child] of Object.entries(this._children)) {
      for (const col of child.columns()) {
        cols.push(`${key}.${col}`)
      }
    }
    return cols
  }

  _resolve(col) {
    const dotIdx = col.indexOf('.')
    if (dotIdx === -1) return null
    const prefix = col.slice(0, dotIdx)
    const rest = col.slice(dotIdx + 1)
    const child = this._children[prefix]
    if (!child) return null
    return { child, rest }
  }

  getData(col) {
    const r = this._resolve(col)
    return r ? r.child.getData(r.rest) : undefined
  }

  getQuantityKind(col) {
    const r = this._resolve(col)
    return r ? r.child.getQuantityKind(r.rest) : undefined
  }

  getDomain(col) {
    const r = this._resolve(col)
    return r ? r.child.getDomain(r.rest) : undefined
  }
}

export function normalizeData(data) {
  if (data == null) return null
  const wrapped = Data.wrap(data)
  return (wrapped instanceof DataGroup) ? wrapped : new DataGroup({ input: wrapped })
}

export class Data {
  constructor(raw) {
    raw = raw ?? {}
    if (raw.data != null && typeof raw.data === 'object' && !(raw.data instanceof Float32Array)) {
      this._columnar = true
      this._data = raw.data
      this._quantityKinds = raw.quantity_kinds ?? {}
      this._rawDomains = raw.domains ?? {}
    } else {
      this._columnar = false
      this._raw = raw
    }
  }

  static wrap(data) {
    if (data != null && typeof data.columns === 'function' && typeof data.getData === 'function') {
      return data
    }

    if (data != null && typeof data === 'object') {
      const isColumnar = data.data != null && typeof data.data === 'object' && !(data.data instanceof Float32Array)

      if (!isColumnar) {
        const vals = Object.values(data)
        if (vals.length > 0) {
          const isRawFormat = vals.every(v =>
            v instanceof Float32Array ||
            (v && typeof v === 'object' && v.data instanceof Float32Array)
          )
          if (!isRawFormat) {
            return new DataGroup(data)
          }
        }
      }
    }

    return new Data(data)
  }

  _entry(col) {
    if (this._columnar) {
      const rawDomain = this._rawDomains[col]
      let domain
      if (Array.isArray(rawDomain)) {
        domain = [rawDomain[0], rawDomain[1]]
      } else if (rawDomain && typeof rawDomain === 'object') {
        domain = [rawDomain.min, rawDomain.max]
      }
      return { data: this._data[col], quantityKind: this._quantityKinds[col], domain }
    }

    const v = this._raw[col]
    if (v instanceof Float32Array) {
      return { data: v, quantityKind: undefined, domain: undefined }
    }
    if (v && typeof v === 'object') {
      let domain
      if (Array.isArray(v.domain)) {
        domain = [v.domain[0], v.domain[1]]
      } else if (v.domain && typeof v.domain === 'object') {
        domain = [v.domain.min, v.domain.max]
      }
      return { data: v.data, quantityKind: v.quantity_kind, domain }
    }
    return { data: undefined, quantityKind: undefined, domain: undefined }
  }

  columns() {
    return this._columnar ? Object.keys(this._data) : Object.keys(this._raw)
  }

  // Returns ArrayColumn (with domain + quantityKind) or null if column not found.
  getData(col) {
    const entry = this._entry(col)
    if (!entry.data) return null
    return new ArrayColumn(entry.data, { domain: entry.domain ?? null, quantityKind: entry.quantityKind ?? null })
  }

  getQuantityKind(col) {
    return this._entry(col).quantityKind
  }

  getDomain(col) {
    return this._entry(col).domain
  }
}
