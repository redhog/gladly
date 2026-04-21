import proj4 from 'proj4'
import { LayerType } from '../core/LayerType.js'
import { ColumnData, uploadToTexture } from '../data/ColumnData.js'
import { AXES } from '../axes/AxisRegistry.js'
import { registerLayerType } from '../core/LayerTypeRegistry.js'
import { parseCrsCode, crsToQkX, crsToQkY, ensureCrsDefined } from '../geo/EpsgUtils.js'

// ─── Tile math (standard Web Mercator / "slippy map" grid) ────────────────────

const EARTH_RADIUS = 6378137          // metres (WGS84 semi-major axis)
const MERC_MAX = Math.PI * EARTH_RADIUS   // ~20037508.34 m

function mercXToNorm(x) { return (x + MERC_MAX) / (2 * MERC_MAX) }
function mercYToNorm(y) { return (1 - y / MERC_MAX) / 2 }
function normToMercX(nx) { return nx * 2 * MERC_MAX - MERC_MAX }
function normToMercY(ny) { return (1 - 2 * ny) * MERC_MAX }

export function mercToTileXY(x, y, z) {
  const scale = Math.pow(2, z)
  return [
    Math.floor(mercXToNorm(x) * scale),
    Math.floor(mercYToNorm(y) * scale),
  ]
}

export function tileToMercBbox(tx, ty, z) {
  const scale = Math.pow(2, z)
  return {
    minX: normToMercX(tx / scale),
    maxX: normToMercX((tx + 1) / scale),
    minY: normToMercY((ty + 1) / scale),  // tile y is top-down, merc y is bottom-up
    maxY: normToMercY(ty / scale),
  }
}

export function optimalZoom(bboxInTileCrs, pixelWidth, pixelHeight, minZoom, maxZoom) {
  const xExtent = Math.abs(bboxInTileCrs.maxX - bboxInTileCrs.minX)
  const yExtent = Math.abs(bboxInTileCrs.maxY - bboxInTileCrs.minY)
  const worldSize = 2 * MERC_MAX
  const zx = xExtent > 0 ? Math.log2((pixelWidth  / 256) * (worldSize / xExtent)) : Infinity
  const zy = yExtent > 0 ? Math.log2((pixelHeight / 256) * (worldSize / yExtent)) : Infinity
  const z = Math.min(zx, zy)
  return Math.min(Math.max(Math.floor(isFinite(z) ? z : maxZoom), minZoom), maxZoom)
}

// ─── Source resolution ────────────────────────────────────────────────────────

export function resolveSource(source) {
  const type = Object.keys(source).find(k => k === 'xyz' || k === 'wms' || k === 'wmts')
  if (!type) throw new Error(`source must have exactly one key of: xyz, wms, wmts`)
  return { type, ...source[type] }
}

// ─── URL builders ──────────────────────────────────────────────────────────────

export function buildXyzUrl(source, z, x, y) {
  const subdomains = source.subdomains ?? ['a', 'b', 'c']
  const s = subdomains[Math.abs(x + y) % subdomains.length]
  return source.url
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', s)
}

export function buildWmtsUrl(source, z, x, y) {
  const url = source.url
  if (url.includes('{TileMatrix}') || url.includes('{z}')) {
    return url
      .replace('{TileMatrix}', z).replace('{z}', z)
      .replace('{TileRow}', y).replace('{y}', y)
      .replace('{TileCol}', x).replace('{x}', x)
  }
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: source.layer,
    STYLE: source.style ?? 'default',
    FORMAT: source.format ?? 'image/png',
    TILEMATRIXSET: source.tileMatrixSet ?? 'WebMercatorQuad',
    TILEMATRIX: z,
    TILEROW: y,
    TILECOL: x,
  })
  return `${source.url}?${params}`
}

export function buildWmsUrl(source, bbox, tileCrs, pixelWidth, pixelHeight) {
  const version = source.version ?? '1.3.0'
  const crsParam = `EPSG:${parseCrsCode(tileCrs)}`

  const is13 = version === '1.3.0'
  const epsgCode = parseCrsCode(crsParam)
  const swapAxes = is13 && (epsgCode === 4326)
  const bboxStr = swapAxes
    ? `${bbox.minY},${bbox.minX},${bbox.maxY},${bbox.maxX}`
    : `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`

  const crsKey = is13 ? 'CRS' : 'SRS'
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: version,
    REQUEST: 'GetMap',
    LAYERS: source.layers,
    [crsKey]: crsParam,
    BBOX: bboxStr,
    WIDTH: Math.round(pixelWidth),
    HEIGHT: Math.round(pixelHeight),
    FORMAT: source.format ?? 'image/png',
    TRANSPARENT: source.transparent !== false ? 'TRUE' : 'FALSE',
    ...(source.styles ? { STYLES: source.styles } : {}),
  })
  return `${source.url}?${params}`
}

// ─── Tessellated mesh builder ──────────────────────────────────────────────────

/**
 * Build a pre-expanded (non-indexed) tessellated mesh for one tile.
 *
 * @param {{ minX, maxX, minY, maxY }} tileBbox  - bbox in tileCrs
 * @param {string} tileCrs  - e.g. "EPSG:3857"
 * @param {string} plotCrs  - e.g. "EPSG:26911" (may equal tileCrs)
 * @param {number} N        - tessellation grid size (N×N quads)
 * @returns {{ positions: Float32Array, uvs: Float32Array, vertexCount: number }}
 *   positions and uvs are pre-expanded: N*N*6 vertices (two CCW triangles per quad).
 *   uvs are identical for all tiles with the same N (bbox-independent).
 */
function buildTileMesh(tileBbox, tileCrs, plotCrs, N) {
  const sameProj = `EPSG:${parseCrsCode(tileCrs)}` === `EPSG:${parseCrsCode(plotCrs)}`
  const project = sameProj ? null : proj4(`EPSG:${parseCrsCode(tileCrs)}`, `EPSG:${parseCrsCode(plotCrs)}`).forward

  const numGridVerts = (N + 1) * (N + 1)
  const gridPos = new Float32Array(numGridVerts * 2)
  const gridUvs = new Float32Array(numGridVerts * 2)

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const v = j / N
      const tileX = tileBbox.minX + u * (tileBbox.maxX - tileBbox.minX)
      const tileY = tileBbox.minY + v * (tileBbox.maxY - tileBbox.minY)

      let px, py
      if (project) {
        ;[px, py] = project([tileX, tileY])
      } else {
        px = tileX
        py = tileY
      }

      const vi = j * (N + 1) + i
      gridPos[vi * 2]     = px
      gridPos[vi * 2 + 1] = py
      gridUvs[vi * 2]     = u
      gridUvs[vi * 2 + 1] = 1 - v  // flip v: tile y=0 is top, GL texture v=0 is bottom
    }
  }

  // Expand to non-indexed triangles: two CCW triangles per quad
  const vertexCount = N * N * 6
  const positions = new Float32Array(vertexCount * 2)
  const uvs = new Float32Array(vertexCount * 2)
  let out = 0
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const bl = j * (N + 1) + i
      const br = bl + 1
      const tl = bl + (N + 1)
      const tr = tl + 1
      for (const vi of [bl, br, tr, bl, tr, tl]) {
        positions[out * 2]     = gridPos[vi * 2]
        positions[out * 2 + 1] = gridPos[vi * 2 + 1]
        uvs[out * 2]     = gridUvs[vi * 2]
        uvs[out * 2 + 1] = gridUvs[vi * 2 + 1]
        out++
      }
    }
  }

  return { positions, uvs, vertexCount }
}

// ─── TilePositionColumn ────────────────────────────────────────────────────────
// ColumnData subclass that wraps a live fn[] array of per-tile position textures.
// refresh(plot) calls syncFn so the tile manager updates tile coverage each frame.

class TilePositionColumn extends ColumnData {
  constructor(vertexCount, texFns, syncFn) {
    super()
    this._vertexCount = vertexCount
    this._texFns = texFns   // live fn[] managed by TileManager; starts as [() => null]
    this._syncFn = syncFn
  }

  get length()  { return this._vertexCount }
  get shape()   { return [this._vertexCount] }

  resolve(path, _regl) {
    return {
      glslExpr: `sampleColumn(u_col_${path}, a_pickId)`,
      textures: { [`u_col_${path}`]: this._texFns },
      shape: [this._vertexCount],
    }
  }

  toTexture() { return this._texFns.map(fn => fn()) }

  async refresh(plot) {
    this._syncFn(plot)
    return false
  }
}

// ─── TileManager ──────────────────────────────────────────────────────────────

const MAX_TILE_CACHE = 50
const DOMAIN_CHANGE_THRESHOLD = 0.02  // 2% change triggers tile sync

class TileManager {
  constructor({ regl, source, tileCrs, plotCrs, tessellation, xTexFns, yTexFns, imageTexFns, onLoad }) {
    this.regl = regl
    this.source = source
    this.tileCrs = tileCrs
    this.plotCrs = plotCrs
    this.tessellation = tessellation
    this._xTexFns = xTexFns
    this._yTexFns = yTexFns
    this._imageTexFns = imageTexFns
    this.onLoad = onLoad

    this.tiles = new Map()
    this.accessOrder = []
    this._neededKeys = new Set()

    this._lastXDomain = null
    this._lastYDomain = null
    this._lastViewport = null

    const fromCode = parseCrsCode(plotCrs)
    const toCode = parseCrsCode(tileCrs)
    this._plotToTile = fromCode === toCode
      ? (pt) => pt
      : proj4(`EPSG:${fromCode}`, `EPSG:${toCode}`).forward
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
      return xDomain[0] !== this._lastXDomain[0] ||
             xDomain[1] !== this._lastXDomain[1] ||
             yDomain[0] !== this._lastYDomain[0] ||
             yDomain[1] !== this._lastYDomain[1] ||
             viewChanged
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
      [xDomain[0], yDomain[0]],
      [xDomain[1], yDomain[0]],
      [xDomain[0], yDomain[1]],
      [xDomain[1], yDomain[1]],
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
      const wmsUrl = buildWmsUrl(source, tileBbox, this.tileCrs, viewport.width, viewport.height)
      return [{ key: wmsUrl, bbox: tileBbox, url: wmsUrl, type: 'wms' }]
    }

    const minZoom = source.minZoom ?? 0
    const maxZoom = source.maxZoom ?? 19
    const z = optimalZoom(tileBbox, viewport.width, viewport.height, minZoom, maxZoom)

    const [xMin, yMax] = mercToTileXY(tileBbox.minX, tileBbox.minY, z)
    const [xMax, yMin] = mercToTileXY(tileBbox.maxX, tileBbox.maxY, z)
    const tileCount = Math.pow(2, z)
    const txMin = Math.max(0, xMin)
    const txMax = Math.min(tileCount - 1, xMax)
    const tyMin = Math.max(0, yMin)
    const tyMax = Math.min(tileCount - 1, yMax)

    const MAX_TILES = 512
    if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > MAX_TILES) {
      console.warn(`[TileLayer] tile range too large (${txMax - txMin + 1}×${tyMax - tyMin + 1} at z=${z}), skipping`)
      return []
    }

    const tiles = []
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const url = source.type === 'wmts'
          ? buildWmtsUrl(source, z, tx, ty)
          : buildXyzUrl(source, z, tx, ty)
        const bbox = tileToMercBbox(tx, ty, z)
        tiles.push({ key: `${z}/${tx}/${ty}`, bbox, url, type: source.type })
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

    for (const tileSpec of needed) {
      if (!this.tiles.has(tileSpec.key)) {
        this._loadTile(tileSpec)
      }
    }
  }

  _evictTile(key) {
    const tile = this.tiles.get(key)
    if (!tile) return
    if (tile.imgTex) tile.imgTex.destroy()
    if (tile.xTex) tile.xTex.destroy()
    if (tile.yTex) tile.yTex.destroy()
    this.tiles.delete(key)
    const i = this.accessOrder.indexOf(key)
    if (i >= 0) this.accessOrder.splice(i, 1)
  }

  _rebuildArrays() {
    const loaded = [...this.tiles.values()].filter(t => t.status === 'loaded')
    this._xTexFns.length = 0
    this._yTexFns.length = 0
    this._imageTexFns.length = 0
    // Always keep at least one entry so isTiledTexClosure detection stays true.
    if (loaded.length === 0) {
      this._xTexFns.push(() => null)
      this._yTexFns.push(() => null)
      this._imageTexFns.push(() => null)
      return
    }
    for (const tile of loaded) {
      this._xTexFns.push(() => tile.xTex)
      this._yTexFns.push(() => tile.yTex)
      this._imageTexFns.push(() => tile.imgTex)
    }
  }

  async _loadTile(tileSpec) {
    this.tiles.set(tileSpec.key, { status: 'loading' })
    this.accessOrder.push(tileSpec.key)

    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error(`Failed to load tile: ${tileSpec.url}`))
        img.src = tileSpec.url
      })

      if (!this.tiles.has(tileSpec.key)) return

      const mesh = buildTileMesh(tileSpec.bbox, this.tileCrs, this.plotCrs, this.tessellation)
      const imgTex = this.regl.texture({ data: img, flipY: false, min: 'linear', mag: 'linear' })

      // De-interleave xy positions into separate packed float textures
      const n = mesh.vertexCount
      const xArr = new Float32Array(n)
      const yArr = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        xArr[i] = mesh.positions[i * 2]
        yArr[i] = mesh.positions[i * 2 + 1]
      }
      const xTex = uploadToTexture(this.regl, xArr)
      const yTex = uploadToTexture(this.regl, yArr)

      this.tiles.set(tileSpec.key, { status: 'loaded', imgTex, xTex, yTex })

      const neededKeys = this._neededKeys
      if (this.source.type === 'wms') {
        for (const key of [...this.tiles.keys()]) {
          if (key !== tileSpec.key && !neededKeys.has(key)) this._evictTile(key)
        }
      } else if (this.tiles.size > MAX_TILE_CACHE) {
        for (const key of this.accessOrder) {
          if (key !== tileSpec.key && !neededKeys.has(key) && this.tiles.has(key)) {
            this._evictTile(key)
            if (this.tiles.size <= MAX_TILE_CACHE) break
          }
        }
      }

      this._rebuildArrays()
      this.onLoad()
    } catch (err) {
      this.tiles.delete(tileSpec.key)
      const i = this.accessOrder.indexOf(tileSpec.key)
      if (i >= 0) this.accessOrder.splice(i, 1)
      console.warn(`[TileLayer] ${err.message}`)
    }
  }

  destroy() {
    for (const key of [...this.tiles.keys()]) {
      this._evictTile(key)
    }
  }
}

// ─── GLSL ─────────────────────────────────────────────────────────────────────
// x_pos and y_pos are injected as float variables by the column system (sampleColumn).
// uv is a plain vertex buffer attribute (same for all tiles with same tessellation N).

const TILE_VERT = `#version 300 es
  precision mediump float;
  in vec2 uv;
  out vec2 vUv;

  void main() {
    gl_Position = plot_pos(vec2(x_pos, y_pos));
    vUv = uv;
  }
`

// out vec4 fragColor is injected by LayerType (buildApplyColorGlsl).
const TILE_FRAG = `#version 300 es
  precision mediump float;
  uniform sampler2D tileTexture;
  uniform float opacity;
  in vec2 vUv;

  void main() {
    vec4 color = texture(tileTexture, vUv);
    fragColor = gladly_apply_color(vec4(color.rgb, color.a * opacity));
  }
`

// ─── TileLayerType ────────────────────────────────────────────────────────────

class TileLayerType extends LayerType {
  constructor() {
    super({ name: 'tile', vert: TILE_VERT, frag: TILE_FRAG, suppressWarnings: true })
  }

  schema(_data) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        source: {
          type: 'object',
          description: 'Tile source configuration. Exactly one key (xyz, wms, or wmts) must be present.',
          anyOf: [
            {
              title: 'XYZ',
              properties: {
                xyz: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', default: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', description: 'URL template with {z}, {x}, {y}, optional {s}' },
                    subdomains: { type: 'array', items: { type: 'string' }, default: ['a', 'b', 'c'], description: 'Subdomain letters for {s}' },
                    minZoom: { type: 'integer', default: 0 },
                    maxZoom: { type: 'integer', default: 19 },
                  },
                  required: ['url'],
                  default: {
                    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    subdomains: ['a', 'b', 'c'],
                  },
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
                    url: { type: 'string', default: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', description: 'WMS service base URL' },
                    layers: { type: 'string', default: 'BlueMarble_NextGeneration', description: 'Comma-separated layer names' },
                    styles: { type: 'string', default: '', description: 'Comma-separated style names (optional)' },
                    format: { type: 'string', default: 'image/jpeg' },
                    version: { type: 'string', enum: ['1.1.1', '1.3.0'], default: '1.1.1' },
                    transparent: { type: 'boolean', default: false },
                  },
                  required: ['url', 'layers'],
                  default: {
                    url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
                    layers: 'BlueMarble_NextGeneration',
                    format: 'image/jpeg',
                    transparent: false,
                    version: '1.1.1',
                  },
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
                    url: { type: 'string', default: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS', description: 'WMTS base URL (RESTful template or KVP endpoint)' },
                    layer: { type: 'string', default: 'USGSTopo' },
                    style: { type: 'string', default: 'default' },
                    format: { type: 'string', default: 'image/jpeg' },
                    tileMatrixSet: { type: 'string', default: 'GoogleMapsCompatible' },
                    minZoom: { type: 'integer', default: 0 },
                    maxZoom: { type: 'integer', default: 19 },
                  },
                  required: ['url', 'layer'],
                  default: {
                    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS',
                    layer: 'USGSTopo',
                    tileMatrixSet: 'GoogleMapsCompatible',
                    format: 'image/jpeg',
                  },
                },
              },
              required: ['wmts'],
              additionalProperties: false,
            },
          ],
          default: {
            xyz: {
              url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              subdomains: ['a', 'b', 'c'],
            },
          },
        },
        tileCrs: {
          type: 'string',
          default: 'EPSG:3857',
          description: 'CRS of the tile service. For XYZ/WMTS this is the tile grid CRS; for WMS this becomes the CRS/SRS parameter in GetMap requests. Defaults to EPSG:3857 (Web Mercator).',
          examples: ['EPSG:3857', 'EPSG:4326'],
        },
        plotCrs: {
          type: 'string',
          description: 'CRS of the plot axes (e.g. "EPSG:26911"). Defaults to tileCrs (no reprojection).',
        },
        tessellation: {
          type: 'integer',
          default: 8,
          minimum: 1,
          description: 'Grid resolution (N×N quads per tile) for reprojection accuracy.',
        },
        opacity: {
          type: 'number',
          default: 1.0,
          minimum: 0,
          maximum: 1,
        },
        xAxis: { type: 'string', enum: AXES.filter(a => a.includes('x')), default: 'xaxis_bottom' },
        yAxis: { type: 'string', enum: AXES.filter(a => a.includes('y')), default: 'yaxis_left' },
      },
      required: ['source'],
    }
  }

  resolveAxisConfig(parameters, _data) {
    const {
      xAxis = 'xaxis_bottom',
      yAxis = 'yaxis_left',
      plotCrs,
      tileCrs,
    } = parameters
    const effectiveTileCrs = tileCrs ?? 'EPSG:3857'
    const effectivePlotCrs = plotCrs ?? effectiveTileCrs
    return {
      xAxis,
      xAxisQuantityKind: crsToQkX(effectivePlotCrs),
      yAxis,
      yAxisQuantityKind: crsToQkY(effectivePlotCrs),
      colorAxisQuantityKinds: {},
      filterAxisQuantityKinds: {},
    }
  }

  createLayer(regl, parameters, _data, plot) {
    const {
      xAxis = 'xaxis_bottom',
      yAxis = 'yaxis_left',
      plotCrs,
      tileCrs,
      source: sourceSpec,
      tessellation = 8,
      opacity = 1.0,
    } = parameters
    const effectiveTileCrs = tileCrs ?? 'EPSG:3857'
    const effectivePlotCrs = plotCrs ?? effectiveTileCrs
    const N = tessellation
    const source = resolveSource(sourceSpec)
    const axisConfig = this.resolveAxisConfig(parameters, _data)

    // Pre-compute shared UV data — same for all tiles with the same tessellation N.
    const { uvs: sharedUvs, vertexCount } = buildTileMesh(
      { minX: 0, maxX: 1, minY: 0, maxY: 1 }, 'EPSG:3857', 'EPSG:3857', N
    )

    // Live fn[] arrays — spliced by TileManager as tiles load and are evicted.
    // Start as [() => null] so isTiledTexClosure detects them at compile time,
    // and the null-skip in the render loop suppresses drawing until tiles arrive.
    const xTexFns = [() => null]
    const yTexFns = [() => null]
    const imageTexFns = [() => null]

    const tileManagerRef = { manager: null }

    // syncFn is called by TilePositionColumn.refresh() on every render frame.
    const syncFn = (renderPlot) => {
      if (!tileManagerRef.manager) return
      const xScale = renderPlot.axisRegistry.getScale(xAxis)
      const yScale = renderPlot.axisRegistry.getScale(yAxis)
      if (!xScale || !yScale) return
      tileManagerRef.manager.syncTiles(
        xScale.domain(),
        yScale.domain(),
        { width: renderPlot.canvas.width, height: renderPlot.canvas.height }
      )
    }

    const xCol = new TilePositionColumn(vertexCount, xTexFns, syncFn)
    const yCol = new TilePositionColumn(vertexCount, yTexFns, syncFn)

    // Async CRS init — create TileManager once proj4 defs are loaded.
    Promise.all([
      ensureCrsDefined(effectiveTileCrs),
      ensureCrsDefined(effectivePlotCrs),
    ]).then(() => {
      try {
        tileManagerRef.manager = new TileManager({
          regl, source,
          tileCrs: effectiveTileCrs, plotCrs: effectivePlotCrs, tessellation: N,
          xTexFns, yTexFns, imageTexFns,
          onLoad: () => plot.scheduleRender(),
        })
        plot.scheduleRender()
      } catch (_) {
        // regl was destroyed before CRS resolved — silently ignore
      }
    }).catch(err => {
      console.error('[TileLayer] CRS initialization failed:', err)
    })

    return [{
      type: this,
      xAxis,
      yAxis,
      xAxisQuantityKind: axisConfig.xAxisQuantityKind,
      yAxisQuantityKind: axisConfig.yAxisQuantityKind,
      colorAxes: {},
      colorAxes2d: {},
      filterAxes: {},
      vertexCount,
      primitive: 'triangles',
      lineWidth: 1,
      instanceCount: null,
      attributeDivisors: {},
      // x_pos and y_pos: TilePositionColumn — one texture per loaded tile.
      // uv: Float32Array buffer attribute — shared across all tiles (bbox-independent).
      attributes: { x_pos: xCol, y_pos: yCol, uv: sharedUvs },
      // tileTexture: live fn[] of per-tile image textures, detected as tiled closure.
      uniforms: { tileTexture: imageTexFns, opacity },
      domains: {},
      blend: { enable: true, func: { src: 'src alpha', dst: 'one minus src alpha' } },
      parameters,
    }]
  }

  async createDrawCommand(regl, layer, plot) {
    const drawConfig = await LayerType.prototype.createDrawCommand.call(this, regl, layer, plot)
    return { ...drawConfig, depth: { enable: false } }
  }
}

export const tileLayerType = new TileLayerType()
registerLayerType('tile', tileLayerType)

export { TileLayerType }
