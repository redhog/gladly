import proj4 from 'proj4'
import { LayerType } from '../core/LayerType.js'
import { ColumnData, uploadToTexture } from '../data/ColumnData.js'
import { AXES } from '../axes/AxisRegistry.js'
import { registerLayerType } from '../core/LayerTypeRegistry.js'
import { parseCrsCode, crsToQkX, crsToQkY, ensureCrsDefined } from '../geo/EpsgUtils.js'
import {
  buildXyzUrl, buildWmtsUrl, buildWmsUrl, optimalZoom,
  mercToTileXY, tileToMercBbox, resolveSource,
} from './TileLayer.js'

const DOMAIN_CHANGE_THRESHOLD = 0.02
const MAX_TILE_CACHE = 50

// ─── Terrain mesh builder ─────────────────────────────────────────────────────

function buildTerrainTileMesh(tileBbox, dtmTileCrs, plotCrs, satTileCrs, N) {
  const dtmCode  = parseCrsCode(dtmTileCrs)
  const plotCode = parseCrsCode(plotCrs)
  const satCode  = parseCrsCode(satTileCrs)

  const dtmToPlot = dtmCode === plotCode
    ? null : proj4(`EPSG:${dtmCode}`, `EPSG:${plotCode}`).forward
  const dtmToSat  = dtmCode === satCode
    ? null : proj4(`EPSG:${dtmCode}`, `EPSG:${satCode}`).forward

  const numGrid = (N + 1) * (N + 1)
  const gridPlot = new Float32Array(numGrid * 2)
  const gridSat  = new Float32Array(numGrid * 2)

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = j / N
      const tx = tileBbox.minX + u * (tileBbox.maxX - tileBbox.minX)
      const ty = tileBbox.minY + v * (tileBbox.maxY - tileBbox.minY)
      const [px, py] = dtmToPlot ? dtmToPlot([tx, ty]) : [tx, ty]
      const [sx, sy] = dtmToSat  ? dtmToSat([tx, ty])  : [tx, ty]
      const vi = j * (N + 1) + i
      gridPlot[vi * 2] = px;  gridPlot[vi * 2 + 1] = py
      gridSat[vi * 2]  = sx;  gridSat[vi * 2 + 1]  = sy
    }
  }

  const vertexCount  = N * N * 6
  const positions    = new Float32Array(vertexCount * 2)
  const satPositions = new Float32Array(vertexCount * 2)
  let out = 0
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const bl = j * (N + 1) + i
      const br = bl + 1
      const tl = bl + (N + 1)
      const tr = tl + 1
      for (const vi of [bl, br, tr, bl, tr, tl]) {
        positions[out * 2]        = gridPlot[vi * 2];  positions[out * 2 + 1]    = gridPlot[vi * 2 + 1]
        satPositions[out * 2]     = gridSat[vi * 2];   satPositions[out * 2 + 1] = gridSat[vi * 2 + 1]
        out++
      }
    }
  }

  let mnSX = Infinity, mxSX = -Infinity, mnSY = Infinity, mxSY = -Infinity
  for (let k = 0; k < vertexCount; k++) {
    const sx = satPositions[k * 2], sy = satPositions[k * 2 + 1]
    if (sx < mnSX) mnSX = sx;  if (sx > mxSX) mxSX = sx
    if (sy < mnSY) mnSY = sy;  if (sy > mxSY) mxSY = sy
  }

  return {
    positions, satPositions, vertexCount,
    satCrsBbox: { minX: mnSX, maxX: mxSX, minY: mnSY, maxY: mxSY },
  }
}

// ─── TerrainColumn ────────────────────────────────────────────────────────────
// ColumnData wrapping a live fn[] of per-tile position textures.
// refresh(plot) calls syncFn so tile coverage updates each frame.

class TerrainColumn extends ColumnData {
  constructor(vertexCount, texFns, syncFn) {
    super()
    this._vertexCount = vertexCount
    this._texFns = texFns
    this._syncFn = syncFn
  }
  get length() { return this._vertexCount }
  get shape()  { return [this._vertexCount] }
  resolve(path, _regl) {
    return {
      glslExpr: `sampleColumn(u_col_${path}, a_pickId)`,
      textures: { [`u_col_${path}`]: this._texFns },
    }
  }
  toTexture() { return this._texFns.map(fn => fn()) }
  async refresh(plot) {
    this._syncFn(plot)
    return false
  }
}

// ─── DtmTileManager ──────────────────────────────────────────────────────────

class DtmTileManager {
  constructor({ regl, source, dtmTileCrs, plotCrs, satTileCrs, tessellation,
                xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
                satTexFns, satBoundsMinFns, satBoundsSizeFns,
                satCacheRef, onLoad }) {
    this.regl = regl
    this.source = source
    this.dtmTileCrs   = dtmTileCrs
    this.plotCrs      = plotCrs
    this.satTileCrs   = satTileCrs
    this.tessellation = tessellation
    this._fns = { xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
                  satTexFns, satBoundsMinFns, satBoundsSizeFns }
    this._satCacheRef = satCacheRef
    this.onLoad = onLoad

    this.tiles = new Map()
    this.accessOrder = []
    this._neededKeys = new Set()
    this._lastXDomain = null
    this._lastYDomain = null
    this._lastViewport = null

    const fromCode = parseCrsCode(plotCrs)
    const toCode   = parseCrsCode(dtmTileCrs)
    this._plotToTile = fromCode === toCode
      ? (pt) => pt
      : proj4(`EPSG:${fromCode}`, `EPSG:${toCode}`).forward

    this._rebuildArrays()
  }

  _domainChanged(xDomain, yDomain, viewport) {
    if (!this._lastXDomain || !this._lastYDomain) return true
    const viewChanged = !!(viewport && this._lastViewport && (
      viewport.width !== this._lastViewport.width ||
      viewport.height !== this._lastViewport.height
    ))
    const dx = Math.abs(xDomain[1] - xDomain[0])
    const dy = Math.abs(yDomain[1] - yDomain[0])
    if (dx === 0 || dy === 0) {
      return xDomain[0] !== this._lastXDomain[0] || xDomain[1] !== this._lastXDomain[1] ||
             yDomain[0] !== this._lastYDomain[0] || yDomain[1] !== this._lastYDomain[1] || viewChanged
    }
    const xChange = Math.max(
      Math.abs(xDomain[0] - this._lastXDomain[0]) / dx,
      Math.abs(xDomain[1] - this._lastXDomain[1]) / dx
    )
    const yChange = Math.max(
      Math.abs(yDomain[0] - this._lastYDomain[0]) / dy,
      Math.abs(yDomain[1] - this._lastYDomain[1]) / dy
    )
    return xChange > DOMAIN_CHANGE_THRESHOLD || yChange > DOMAIN_CHANGE_THRESHOLD || viewChanged
  }

  _plotBboxToTileBbox(xDomain, yDomain) {
    const corners = [
      [xDomain[0], yDomain[0]], [xDomain[1], yDomain[0]],
      [xDomain[0], yDomain[1]], [xDomain[1], yDomain[1]],
    ].map(pt => this._plotToTile(pt))
    return {
      minX: Math.min(...corners.map(c => c[0])),
      maxX: Math.max(...corners.map(c => c[0])),
      minY: Math.min(...corners.map(c => c[1])),
      maxY: Math.max(...corners.map(c => c[1])),
    }
  }

  _computeNeededTiles(xDomain, yDomain, viewport) {
    const tileBbox = this._plotBboxToTileBbox(xDomain, yDomain)
    const source = this.source
    if (source.type === 'wms') {
      const url = buildWmsUrl(source, tileBbox, this.dtmTileCrs, viewport.width, viewport.height)
      return [{ key: url, bbox: tileBbox, url, type: 'wms' }]
    }
    const minZoom = source.minZoom ?? 0
    const maxZoom = source.maxZoom ?? 14
    const z = optimalZoom(tileBbox, viewport.width, viewport.height, minZoom, maxZoom)
    const [xMin, yMax] = mercToTileXY(tileBbox.minX, tileBbox.minY, z)
    const [xMax, yMin] = mercToTileXY(tileBbox.maxX, tileBbox.maxY, z)
    const tc = Math.pow(2, z)
    const txMin = Math.max(0, xMin), txMax = Math.min(tc - 1, xMax)
    const tyMin = Math.max(0, yMin), tyMax = Math.min(tc - 1, yMax)
    if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 64) {
      console.warn('[TerrainTileLayer] DTM tile range too large, skipping')
      return []
    }
    const tiles = []
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const url = source.type === 'wmts'
          ? buildWmtsUrl(source, z, tx, ty)
          : buildXyzUrl(source, z, tx, ty)
        tiles.push({ key: `${z}/${tx}/${ty}`, bbox: tileToMercBbox(tx, ty, z), url })
      }
    }
    return tiles
  }

  syncTiles(xDomain, yDomain, viewport) {
    if (!this._domainChanged(xDomain, yDomain, viewport)) return
    this._lastXDomain = xDomain.slice()
    this._lastYDomain = yDomain.slice()
    this._lastViewport = viewport ? { width: viewport.width, height: viewport.height } : null
    const needed = this._computeNeededTiles(xDomain, yDomain, viewport)
    this._neededKeys = new Set(needed.map(t => t.key))
    for (const spec of needed) {
      if (!this.tiles.has(spec.key)) this._loadTile(spec)
    }
  }

  requestSatTiles(viewport) {
    const satCache = this._satCacheRef.cache
    if (!satCache) return
    for (const tile of this.tiles.values()) {
      if (tile.status === 'loaded') satCache.requestForBbox(tile.slot.satCrsBbox, viewport)
    }
  }

  _rebuildArrays() {
    const loaded = [...this.tiles.values()].filter(t => t.status === 'loaded')
    const { xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
            satTexFns, satBoundsMinFns, satBoundsSizeFns } = this._fns
    for (const arr of [xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
                       satTexFns, satBoundsMinFns, satBoundsSizeFns]) arr.length = 0
    if (loaded.length === 0) {
      for (const arr of [xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
                         satTexFns, satBoundsMinFns, satBoundsSizeFns]) arr.push(() => null)
      return
    }
    const satCacheRef = this._satCacheRef
    for (const tile of loaded) {
      const s = tile.slot
      xTexFns.push(()    => s.xTex)
      zTexFns.push(()    => s.zTex)
      satXTexFns.push(() => s.satXTex)
      satYTexFns.push(() => s.satYTex)
      dtmTexFns.push(()  => s.dtmTex)
      satTexFns.push(()  => satCacheRef.cache?.getBestAvailable(s.satCrsBbox)?.texture ?? null)
      satBoundsMinFns.push(() => {
        const sat = satCacheRef.cache?.getBestAvailable(s.satCrsBbox)
        return sat ? [sat.bounds.minX, sat.bounds.minY] : null
      })
      satBoundsSizeFns.push(() => {
        const sat = satCacheRef.cache?.getBestAvailable(s.satCrsBbox)
        return sat ? [sat.bounds.maxX - sat.bounds.minX, sat.bounds.maxY - sat.bounds.minY] : null
      })
    }
  }

  _evictTile(key) {
    const tile = this.tiles.get(key)
    if (!tile) return
    tile.slot?.xTex?.destroy()
    tile.slot?.zTex?.destroy()
    tile.slot?.satXTex?.destroy()
    tile.slot?.satYTex?.destroy()
    tile.slot?.dtmTex?.destroy()
    this.tiles.delete(key)
    const i = this.accessOrder.indexOf(key)
    if (i >= 0) this.accessOrder.splice(i, 1)
    this._rebuildArrays()
  }

  async _loadTile(spec) {
    this.tiles.set(spec.key, { status: 'loading' })
    this.accessOrder.push(spec.key)
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error(`Failed to load DTM tile: ${spec.url}`))
        img.src = spec.url
      })
      if (!this.tiles.has(spec.key)) return

      const N    = this.tessellation
      const mesh = buildTerrainTileMesh(spec.bbox, this.dtmTileCrs, this.plotCrs, this.satTileCrs, N)
      const dtmTex = this.regl.texture({ data: img, flipY: false, min: 'linear', mag: 'linear' })

      const n = mesh.vertexCount
      const xArr    = new Float32Array(n), zArr    = new Float32Array(n)
      const satXArr = new Float32Array(n), satYArr = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        xArr[i]    = mesh.positions[i * 2];    zArr[i]    = mesh.positions[i * 2 + 1]
        satXArr[i] = mesh.satPositions[i * 2]; satYArr[i] = mesh.satPositions[i * 2 + 1]
      }

      const xTex    = uploadToTexture(this.regl, xArr)
      const zTex    = uploadToTexture(this.regl, zArr)
      const satXTex = uploadToTexture(this.regl, satXArr)
      const satYTex = uploadToTexture(this.regl, satYArr)

      const slot = { xTex, zTex, satXTex, satYTex, dtmTex, satCrsBbox: mesh.satCrsBbox }
      this.tiles.set(spec.key, { status: 'loaded', slot })

      const neededKeys = this._neededKeys
      if (this.source.type === 'wms') {
        for (const key of [...this.tiles.keys()]) {
          if (key !== spec.key && !neededKeys.has(key)) this._evictTile(key)
        }
      } else if (this.tiles.size > MAX_TILE_CACHE) {
        for (const key of this.accessOrder) {
          if (key !== spec.key && !neededKeys.has(key) && this.tiles.has(key)) {
            this._evictTile(key)
            if (this.tiles.size <= MAX_TILE_CACHE) break
          }
        }
      }

      this._rebuildArrays()
      this.onLoad()
    } catch (err) {
      this.tiles.delete(spec.key)
      const i = this.accessOrder.indexOf(spec.key)
      if (i >= 0) this.accessOrder.splice(i, 1)
      console.warn(`[TerrainTileLayer] ${err.message}`)
    }
  }

  destroy() {
    for (const key of [...this.tiles.keys()]) this._evictTile(key)
  }
}

// ─── SatTileCache ─────────────────────────────────────────────────────────────

class SatTileCache {
  constructor({ regl, source, satTileCrs, onLoad }) {
    this.regl = regl
    this.source = source
    this.satTileCrs = satTileCrs
    this.onLoad = onLoad
    this.tiles = new Map()
    this.accessOrder = []
  }

  getBestAvailable(satCrsBbox) {
    const source = this.source
    if (source.type === 'wms') {
      const key  = this._wmsKey(satCrsBbox)
      const tile = this.tiles.get(key)
      return tile?.status === 'loaded' ? { texture: tile.texture, bounds: satCrsBbox } : null
    }
    const cx = (satCrsBbox.minX + satCrsBbox.maxX) / 2
    const cy = (satCrsBbox.minY + satCrsBbox.maxY) / 2
    const minZoom = source.minZoom ?? 0
    const maxZoom = source.maxZoom ?? 19
    for (let z = maxZoom; z >= minZoom; z--) {
      const [tx, ty] = mercToTileXY(cx, cy, z)
      const key  = `${z}/${tx}/${ty}`
      const tile = this.tiles.get(key)
      if (tile?.status === 'loaded') return { texture: tile.texture, bounds: tileToMercBbox(tx, ty, z) }
    }
    return null
  }

  requestForBbox(satCrsBbox, viewport) {
    const source = this.source
    if (source.type === 'wms') {
      const key = this._wmsKey(satCrsBbox)
      if (!this.tiles.has(key)) {
        const url = buildWmsUrl(source, satCrsBbox, this.satTileCrs, viewport?.width ?? 256, viewport?.height ?? 256)
        this._loadTile({ key, url, bounds: satCrsBbox })
      }
      return
    }
    const pixelSize = viewport ? Math.max(viewport.width, viewport.height) / 2 : 256
    const z = optimalZoom(satCrsBbox, pixelSize, pixelSize, source.minZoom ?? 0, source.maxZoom ?? 19)
    const [xMin, yMax] = mercToTileXY(satCrsBbox.minX, satCrsBbox.minY, z)
    const [xMax, yMin] = mercToTileXY(satCrsBbox.maxX, satCrsBbox.maxY, z)
    const tc = Math.pow(2, z)
    for (let ty = Math.max(0, yMin); ty <= Math.min(tc - 1, yMax); ty++) {
      for (let tx = Math.max(0, xMin); tx <= Math.min(tc - 1, xMax); tx++) {
        const key = `${z}/${tx}/${ty}`
        if (!this.tiles.has(key)) {
          const url    = source.type === 'wmts' ? buildWmtsUrl(source, z, tx, ty) : buildXyzUrl(source, z, tx, ty)
          const bounds = tileToMercBbox(tx, ty, z)
          this._loadTile({ key, url, bounds })
        }
      }
    }
  }

  async _loadTile({ key, url, bounds }) {
    this.tiles.set(key, { status: 'loading' })
    this.accessOrder.push(key)
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error(`Failed to load sat tile: ${url}`))
        img.src = url
      })
      if (!this.tiles.has(key)) return
      const texture = this.regl.texture({ data: img, flipY: false, min: 'linear', mag: 'linear' })
      this.tiles.set(key, { status: 'loaded', texture, bounds })
      if (this.tiles.size > MAX_TILE_CACHE) {
        for (const k of this.accessOrder) {
          if (k !== key && this.tiles.has(k)) {
            this.tiles.get(k).texture?.destroy()
            this.tiles.delete(k)
            this.accessOrder.splice(this.accessOrder.indexOf(k), 1)
            if (this.tiles.size <= MAX_TILE_CACHE) break
          }
        }
      }
      this.onLoad()
    } catch (err) {
      this.tiles.delete(key)
      const i = this.accessOrder.indexOf(key)
      if (i >= 0) this.accessOrder.splice(i, 1)
      console.warn(`[TerrainTileLayer] ${err.message}`)
    }
  }

  _wmsKey(bbox) {
    return `wms:${bbox.minX.toFixed(2)},${bbox.minY.toFixed(2)},${bbox.maxX.toFixed(2)},${bbox.maxY.toFixed(2)}`
  }

  destroy() {
    for (const tile of this.tiles.values()) tile.texture?.destroy()
    this.tiles.clear()
  }
}

// ─── GLSL shaders ─────────────────────────────────────────────────────────────
// x_pos, z_pos, sat_x, sat_y are injected by the column system (sampleColumn).
// Spatial helpers (plot_pos_3d, normalize_axis, spatial uniforms) are injected by LayerType.
// a_pickId, v_pickId, v_clip_pos, u_is3D, gladly_apply_color, fragColor, clip discard
// are also injected by LayerType.

const TERRAIN_VERT = `#version 300 es
precision highp float;

in vec2 a_dtm_uv;

uniform sampler2D u_dtm_tex;
uniform float u_dtm_encoding;
uniform float u_elev_scale;
uniform float u_elev_offset;
uniform vec2  u_sat_bounds_min;
uniform vec2  u_sat_bounds_size;

out vec2 v_sat_uv;

float decodeElev(vec4 col) {
  float R = col.r * 255.0;
  float G = col.g * 255.0;
  float B = col.b * 255.0;
  if (u_dtm_encoding < 0.5) return col.r;
  if (u_dtm_encoding < 1.5) return -10000.0 + (R * 65536.0 + G * 256.0 + B) * 0.1;
  return R * 256.0 + G + B / 256.0 - 32768.0;
}

void main() {
  float elevation = decodeElev(texture(u_dtm_tex, a_dtm_uv)) * u_elev_scale + u_elev_offset;
  gl_Position = plot_pos_3d(vec3(x_pos, elevation, z_pos));
  vec2 rawUv = (vec2(sat_x, sat_y) - u_sat_bounds_min) / u_sat_bounds_size;
  v_sat_uv = vec2(rawUv.x, 1.0 - rawUv.y);
}
`

const TERRAIN_FRAG = `#version 300 es
precision mediump float;

in vec2 v_sat_uv;

uniform sampler2D u_sat_tex;
uniform float     u_opacity;

void main() {
  if (v_sat_uv.x < 0.0 || v_sat_uv.x > 1.0 ||
      v_sat_uv.y < 0.0 || v_sat_uv.y > 1.0) discard;
  vec4 color = texture(u_sat_tex, v_sat_uv);
  fragColor = gladly_apply_color(vec4(color.rgb, color.a * u_opacity));
}
`

// ─── TerrainTileLayerType ─────────────────────────────────────────────────────

const SOURCE_SCHEMA = {
  type: 'object',
  description: 'Tile source. Exactly one key (xyz, wms, or wmts) must be present.',
  anyOf: [
    {
      title: 'XYZ',
      properties: {
        xyz: {
          type: 'object',
          properties: {
            url:        { type: 'string', description: 'URL template with {z}, {x}, {y}, optional {s}' },
            subdomains: { type: 'array', items: { type: 'string' }, default: ['a', 'b', 'c'] },
            minZoom:    { type: 'integer', default: 0 },
            maxZoom:    { type: 'integer', default: 19 },
          },
          required: ['url'],
        },
      },
      required: ['xyz'],
      additionalProperties: false,
    },
    {
      title: 'WMS',
      properties: {
        wms: {
          type: 'object',
          properties: {
            url:         { type: 'string' },
            layers:      { type: 'string' },
            styles:      { type: 'string', default: '' },
            format:      { type: 'string', default: 'image/png' },
            version:     { type: 'string', enum: ['1.1.1', '1.3.0'], default: '1.1.1' },
            transparent: { type: 'boolean', default: true },
          },
          required: ['url', 'layers'],
        },
      },
      required: ['wms'],
      additionalProperties: false,
    },
    {
      title: 'WMTS',
      properties: {
        wmts: {
          type: 'object',
          properties: {
            url:           { type: 'string' },
            layer:         { type: 'string' },
            style:         { type: 'string', default: 'default' },
            format:        { type: 'string', default: 'image/png' },
            tileMatrixSet: { type: 'string', default: 'GoogleMapsCompatible' },
            minZoom:       { type: 'integer', default: 0 },
            maxZoom:       { type: 'integer', default: 19 },
          },
          required: ['url', 'layer'],
        },
      },
      required: ['wmts'],
      additionalProperties: false,
    },
  ],
}

class TerrainTileLayerType extends LayerType {
  constructor() {
    super({ name: 'terrain', vert: TERRAIN_VERT, frag: TERRAIN_FRAG, suppressWarnings: true })
  }

  schema(_data) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        dtmSource:   { ...SOURCE_SCHEMA, description: 'Elevation (DTM) tile source' },
        dtmTileCrs:  { type: 'string', default: 'EPSG:3857', description: 'CRS of the DTM tile grid' },
        satSource:   { ...SOURCE_SCHEMA, description: 'Satellite/imagery tile source draped over terrain' },
        satTileCrs:  { type: 'string', default: 'EPSG:3857', description: 'CRS of the satellite tile grid' },
        plotCrs:     { type: 'string', description: 'CRS of the x/z plot axes. Defaults to dtmTileCrs.' },
        tessellation: { type: 'integer', default: 16, minimum: 1, description: 'Grid resolution N×N quads per DTM tile' },
        dtmEncoding: { type: 'string', enum: ['grayscale', 'mapbox', 'terrarium'], default: 'terrarium' },
        elevScale:   { type: 'number', default: 1.0 },
        elevOffset:  { type: 'number', default: 0.0 },
        opacity:     { type: 'number', default: 1.0, minimum: 0, maximum: 1 },
        xAxis: { type: 'string', enum: AXES.filter(a => a.includes('x')), default: 'xaxis_bottom' },
        yAxis: { type: 'string', enum: AXES.filter(a => a.includes('y')), default: 'yaxis_left', description: 'Elevation axis' },
        zAxis: { type: 'string', enum: AXES.filter(a => a.includes('z')), default: 'zaxis_bottom_left' },
      },
      required: ['dtmSource', 'satSource'],
    }
  }

  resolveAxisConfig(parameters, _data) {
    const {
      xAxis = 'xaxis_bottom',
      yAxis = 'yaxis_left',
      zAxis = 'zaxis_bottom_left',
      plotCrs,
      dtmTileCrs = 'EPSG:3857',
    } = parameters
    const effectivePlotCrs = plotCrs ?? dtmTileCrs
    return {
      xAxis,
      xAxisQuantityKind: crsToQkX(effectivePlotCrs),
      yAxis,
      yAxisQuantityKind: 'distance_meters_y',
      zAxis,
      zAxisQuantityKind: crsToQkY(effectivePlotCrs),
      colorAxisQuantityKinds:   {},
      colorAxis2dQuantityKinds: {},
      filterAxisQuantityKinds:  {},
    }
  }

  createLayer(regl, parameters, _data, plot) {
    const {
      xAxis = 'xaxis_bottom',
      yAxis = 'yaxis_left',
      zAxis = 'zaxis_bottom_left',
      dtmTileCrs = 'EPSG:3857',
      satTileCrs = 'EPSG:3857',
      plotCrs,
      dtmSource: dtmSourceSpec,
      satSource: satSourceSpec,
      tessellation = 16,
      dtmEncoding  = 'terrarium',
      elevScale    = 1.0,
      elevOffset   = 0.0,
      opacity      = 1.0,
    } = parameters

    const effectiveDtmTileCrs = dtmTileCrs
    const effectiveSatTileCrs = satTileCrs
    const effectivePlotCrs    = plotCrs ?? effectiveDtmTileCrs

    const axisConfig = this.resolveAxisConfig(parameters, _data)
    const dtmSource  = resolveSource(dtmSourceSpec)
    const satSource  = resolveSource(satSourceSpec)

    const N = tessellation
    const vertexCount = N * N * 6

    // Shared DTM UV buffer — same for all tiles with the same N.
    const dtmUvs = new Float32Array(vertexCount * 2)
    let out = 0
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        for (const [gu, gv] of [[i,j],[i+1,j],[i+1,j+1],[i,j],[i+1,j+1],[i,j+1]]) {
          dtmUvs[out * 2]     = gu / N
          dtmUvs[out * 2 + 1] = 1.0 - gv / N
          out++
        }
      }
    }

    // Live fn[] arrays — one entry per loaded DTM tile. Start with () => null so
    // isTiledTexClosure detects them at compile time; null skips tiles until loaded.
    const xTexFns         = [() => null]
    const zTexFns         = [() => null]
    const satXTexFns      = [() => null]
    const satYTexFns      = [() => null]
    const dtmTexFns       = [() => null]
    const satTexFns       = [() => null]
    const satBoundsMinFns = [() => null]
    const satBoundsSizeFns = [() => null]

    const dtmManagerRef = { manager: null }
    const satCacheRef   = { cache: null }

    const encodingMap  = { grayscale: 0, mapbox: 1, terrarium: 2 }
    const dtmEncodingF = encodingMap[dtmEncoding] ?? 0

    const syncFn = (renderPlot) => {
      if (!dtmManagerRef.manager) return
      const xScale = renderPlot.axisRegistry.getScale(xAxis)
      const zScale = renderPlot.axisRegistry.getScale(zAxis)
      if (!xScale || !zScale) return
      const viewport = { width: renderPlot.canvas.width, height: renderPlot.canvas.height }
      dtmManagerRef.manager.syncTiles(xScale.domain(), zScale.domain(), viewport)
      dtmManagerRef.manager.requestSatTiles(viewport)
    }

    const xCol    = new TerrainColumn(vertexCount, xTexFns,    syncFn)
    const zCol    = new TerrainColumn(vertexCount, zTexFns,    syncFn)
    const satXCol = new TerrainColumn(vertexCount, satXTexFns, syncFn)
    const satYCol = new TerrainColumn(vertexCount, satYTexFns, syncFn)

    Promise.all([
      ensureCrsDefined(effectiveDtmTileCrs),
      ensureCrsDefined(effectiveSatTileCrs),
      ensureCrsDefined(effectivePlotCrs),
    ]).then(() => {
      try {
        dtmManagerRef.manager = new DtmTileManager({
          regl, source: dtmSource,
          dtmTileCrs: effectiveDtmTileCrs,
          plotCrs:    effectivePlotCrs,
          satTileCrs: effectiveSatTileCrs,
          tessellation: N,
          xTexFns, zTexFns, satXTexFns, satYTexFns, dtmTexFns,
          satTexFns, satBoundsMinFns, satBoundsSizeFns,
          satCacheRef,
          onLoad: () => plot.scheduleRender(),
        })
        satCacheRef.cache = new SatTileCache({
          regl, source: satSource,
          satTileCrs: effectiveSatTileCrs,
          onLoad: () => plot.scheduleRender(),
        })
        plot.scheduleRender()
      } catch (_) {}
    }).catch(err => {
      console.error('[TerrainTileLayer] CRS initialization failed:', err)
    })

    return [{
      type: this,
      xAxis,
      yAxis,
      zAxis: axisConfig.zAxis,
      xAxisQuantityKind: axisConfig.xAxisQuantityKind,
      yAxisQuantityKind: axisConfig.yAxisQuantityKind,
      zAxisQuantityKind: axisConfig.zAxisQuantityKind,
      colorAxes:    {},
      colorAxes2d:  {},
      filterAxes:   {},
      vertexCount,
      primitive: 'triangles',
      lineWidth: 1,
      instanceCount: null,
      attributeDivisors: {},
      attributes: {
        a_dtm_uv: dtmUvs,
        x_pos:    xCol,
        z_pos:    zCol,
        sat_x:    satXCol,
        sat_y:    satYCol,
      },
      uniforms: {
        u_dtm_tex:         dtmTexFns,
        u_sat_tex:         satTexFns,
        u_sat_bounds_min:  satBoundsMinFns,
        u_sat_bounds_size: satBoundsSizeFns,
        u_dtm_encoding:    dtmEncodingF,
        u_elev_scale:      elevScale,
        u_elev_offset:     elevOffset,
        u_opacity:         opacity,
      },
      domains: {},
    }]
  }

  async createDrawCommand(regl, layer, plot) {
    const drawConfig = await LayerType.prototype.createDrawCommand.call(this, regl, layer, plot)
    return { ...drawConfig, depth: { enable: true }, blend: { enable: false } }
  }
}

export const terrainTileLayerType = new TerrainTileLayerType()
registerLayerType('terrain', terrainTileLayerType)
export { TerrainTileLayerType }
