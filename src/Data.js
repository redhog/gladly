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
