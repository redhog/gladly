import proj4 from 'proj4'
import { byEpsg } from 'projnames'
import { registerAxisQuantityKind } from '../axes/AxisQuantityKindRegistry.js'

/**
 * Parse an EPSG CRS string or number to a plain integer code.
 * Accepts: 26911, "26911", "EPSG:26911", "epsg:26911"
 */
export function parseCrsCode(crs) {
  if (typeof crs === 'number') return crs
  const m = String(crs).match(/(\d+)$/)
  return m ? parseInt(m[1]) : null
}

/** "EPSG:26911" → "epsg_26911_x" */
export function crsToQkX(crs) {
  return `epsg_${parseCrsCode(crs)}_x`
}

/** "EPSG:26911" → "epsg_26911_y" */
export function crsToQkY(crs) {
  return `epsg_${parseCrsCode(crs)}_y`
}

/** "epsg_26911_x" or "epsg_26911_y" → 26911, or null if not matching */
export function qkToEpsgCode(qk) {
  const m = String(qk).match(/^epsg_(\d+)_[xy]$/)
  return m ? parseInt(m[1]) : null
}

/**
 * Register a proj4 CRS definition and auto-register the matching
 * epsg_CODE_x / epsg_CODE_y quantity kinds with labels from projnames.
 * Useful for offline/air-gapped environments where network access is unavailable.
 *
 * @param {number} epsgCode - e.g. 26911
 * @param {string} proj4string - e.g. "+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs"
 */
export function registerEpsgDef(epsgCode, proj4string) {
  proj4.defs(`EPSG:${epsgCode}`, proj4string)
  _registerQuantityKinds(epsgCode)
}

// ─── Internal auto-fetch machinery ───────────────────────────────────────────

// Labels for EPSG codes absent from (or wrong in) the projnames package.
const EPSG_LABEL_OVERRIDES = {
  4326: 'WGS 84',
}

// Tracks codes whose quantity kinds have been registered (avoids duplicate work)
const _registeredQkCodes = new Set()

// In-flight fetch promises keyed by code (deduplicates concurrent requests)
const _pendingFetches = new Map()

function _registerQuantityKinds(code) {
  if (_registeredQkCodes.has(code)) return
  _registeredQkCodes.add(code)
  const name = EPSG_LABEL_OVERRIDES[code] ?? byEpsg[code] ?? `EPSG:${code}`
  registerAxisQuantityKind(`epsg_${code}_x`, { label: `${name} X`, scale: 'linear' })
  registerAxisQuantityKind(`epsg_${code}_y`, { label: `${name} Y`, scale: 'linear' })
}

/**
 * Ensure a CRS is defined in proj4 and has quantity kinds registered.
 * - If already known to proj4, only registers quantity kinds (synchronous work).
 * - Otherwise fetches the proj4 string from epsg.io (async).
 * - Concurrent calls for the same code share a single in-flight request.
 *
 * @param {string|number} crs - e.g. "EPSG:26911", 26911
 * @returns {Promise<void>}
 */
export async function ensureCrsDefined(crs) {
  const code = parseCrsCode(crs)
  if (!code) throw new Error(`Cannot parse CRS code from: ${crs}`)

  const key = `EPSG:${code}`

  // Register quantity kinds first — this is always synchronous (projnames lookup)
  _registerQuantityKinds(code)

  // If proj4 already has this definition (including built-ins 4326 and 3857), we're done
  if (proj4.defs(key)) return

  // Deduplicate concurrent fetches for the same code
  if (!_pendingFetches.has(code)) {
    const p = fetch(`https://epsg.io/${code}.proj4`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then(def => {
        proj4.defs(key, def.trim())
      })
      .finally(() => {
        _pendingFetches.delete(code)
      })
    _pendingFetches.set(code, p)
  }

  try {
    await _pendingFetches.get(code)
  } catch (err) {
    throw new Error(`Failed to fetch proj4 definition for ${key}: ${err.message}`)
  }
}

/**
 * Reproject a [x, y] point from one CRS to another.
 * Both CRS strings are parsed via parseCrsCode (accepts "EPSG:N", "N", N).
 * The CRS must already be registered (via registerEpsgDef or ensureCrsDefined).
 *
 * @param {string|number} fromCrs
 * @param {string|number} toCrs
 * @param {[number, number]} point
 * @returns {[number, number]}
 */
export function reproject(fromCrs, toCrs, point) {
  const from = `EPSG:${parseCrsCode(fromCrs)}`
  const to = `EPSG:${parseCrsCode(toCrs)}`
  return proj4(from, to).forward(point)
}
