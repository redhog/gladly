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
    this._liveRefs = {}   // { colName: { texture, _isLive: true } }
    this._meta = null
    this._accessedAxes = new Set()
    this._cachedDomains = {}
    this._regl = null
    this._dataGroup = null
  }

  columns() {
    return this._computedData.columns(this._params)
  }

  getData(col) {
    return this._liveRefs[col] ?? null
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
      this._liveRefs[key] = { texture: val, _isLive: true }
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
      // Mutate the existing live ref so dynamic uniform closures pick up the new texture.
      if (this._liveRefs[key]) {
        this._liveRefs[key].texture = val
      } else {
        this._liveRefs[key] = { texture: val, _isLive: true }
      }
    }

    this._accessedAxes = newAccessedAxes
    for (const axisId of newAccessedAxes) {
      newCachedDomains[axisId] = plot ? plot.getAxisDomain(axisId) : null
    }
    this._cachedDomains = newCachedDomains
  }
}

export class DataGroup {
  constructor(raw) {
    this._children = {}
    for (const [key, value] of Object.entries(raw)) {
      this._children[key] = Data.wrap(value)
    }
  }

  // Returns { key: Data } for immediate Data children only.
  listData() {
    const result = {}
    for (const [key, child] of Object.entries(this._children)) {
      if (child instanceof Data) result[key] = child
    }
    return result
  }

  // Returns { key: DataGroup } for immediate DataGroup children only.
  subgroups() {
    const result = {}
    for (const [key, child] of Object.entries(this._children)) {
      if (child instanceof DataGroup) result[key] = child
    }
    return result
  }

  // All dotted column names across all children recursively.
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

export class Data {
  constructor(raw) {
    raw = raw ?? {}
    // Columnar format: { data: {col: Float32Array}, quantity_kinds?: {...}, domains?: {...} }
    // Detected by the presence of a top-level `data` property that is a plain object.
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
        // Not columnar → check if raw format: every value must be Float32Array or {data: Float32Array, ...}
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

  getData(col) {
    return this._entry(col).data
  }

  getQuantityKind(col) {
    return this._entry(col).quantityKind
  }

  getDomain(col) {
    return this._entry(col).domain
  }
}
