import proj4 from 'proj4'
import { LayerType } from './LayerType.js'
import { AXES } from './AxisRegistry.js'
import { registerLayerType } from './LayerTypeRegistry.js'
import { parseCrsCode, crsToQkX, crsToQkY, ensureCrsDefined } from './EpsgUtils.js'

// ─── Tile math (standard Web Mercator / "slippy map" grid) ────────────────────

const EARTH_RADIUS = 6378137          // metres (WGS84 semi-major axis)
const MERC_MAX = Math.PI * EARTH_RADIUS   // ~20037508.34 m

function mercXToNorm(x) { return (x + MERC_MAX) / (2 * MERC_MAX) }
function mercYToNorm(y) { return (1 - y / MERC_MAX) / 2 }
function normToMercX(nx) { return nx * 2 * MERC_MAX - MERC_MAX }
function normToMercY(ny) { return (1 - 2 * ny) * MERC_MAX }

function mercToTileXY(x, y, z) {
  const scale = Math.pow(2, z)
  return [
    Math.floor(mercXToNorm(x) * scale),
    Math.floor(mercYToNorm(y) * scale),
  ]
}

function tileToMercBbox(tx, ty, z) {
  const scale = Math.pow(2, z)
  return {
    minX: normToMercX(tx / scale),
    maxX: normToMercX((tx + 1) / scale),
    minY: normToMercY((ty + 1) / scale),  // tile y is top-down, merc y is bottom-up
    maxY: normToMercY(ty / scale),
  }
}

function optimalZoom(bboxInTileCrs, pixelWidth, minZoom, maxZoom) {
  // Assume tile grid is Web Mercator: one tile = 256 px at zoom 0.
  // Scale factor = pixelWidth / tileWidth_in_tileCrs_units
  // For Web Mercator: tileWidth at zoom 0 = 2 * MERC_MAX
  const xExtent = Math.abs(bboxInTileCrs.maxX - bboxInTileCrs.minX)
  const worldWidth = 2 * MERC_MAX
  const z = Math.log2((pixelWidth / 256) * (worldWidth / xExtent))
  return Math.min(Math.max(Math.floor(z), minZoom), maxZoom)
}

// ─── Source resolution ────────────────────────────────────────────────────────

// source is stored as { xyz: {...} } | { wms: {...} } | { wmts: {...} }
// Normalize to { type: 'xyz'|'wms'|'wmts', ...params } for the rest of the pipeline.
function resolveSource(source) {
  const type = Object.keys(source).find(k => k === 'xyz' || k === 'wms' || k === 'wmts')
  if (!type) throw new Error(`source must have exactly one key of: xyz, wms, wmts`)
  return { type, ...source[type] }
}

// ─── URL builders ──────────────────────────────────────────────────────────────

function buildXyzUrl(source, z, x, y) {
  const subdomains = source.subdomains ?? ['a', 'b', 'c']
  const s = subdomains[Math.abs(x + y) % subdomains.length]
  return source.url
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', s)
}

function buildWmtsUrl(source, z, x, y) {
  // Support both RESTful template ({TileMatrix}, {TileRow}, {TileCol}) and KVP
  const url = source.url
  if (url.includes('{TileMatrix}') || url.includes('{z}')) {
    return url
      .replace('{TileMatrix}', z).replace('{z}', z)
      .replace('{TileRow}', y).replace('{y}', y)
      .replace('{TileCol}', x).replace('{x}', x)
  }
  // KVP style
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

function buildWmsUrl(source, bbox, tileCrs, pixelWidth, pixelHeight) {
  const version = source.version ?? '1.3.0'
  const crsParam = `EPSG:${parseCrsCode(tileCrs)}`

  // WMS 1.3.0 with geographic CRS (EPSG:4326) swaps axis order: BBOX is minLat,minLon,maxLat,maxLon
  const is13 = version === '1.3.0'
  const epsgCode = parseCrsCode(crsParam)
  // EPSG:4326 and other geographic CRS have swapped axes in WMS 1.3.0
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
 * Build a tessellated mesh for one tile.
 *
 * @param {{ minX, maxX, minY, maxY }} tileBbox  - bbox in tileCrs
 * @param {string} tileCrs  - e.g. "EPSG:3857"
 * @param {string} plotCrs  - e.g. "EPSG:26911" (may equal tileCrs)
 * @param {number} N        - tessellation grid size (N×N quads)
 * @returns {{ positions: Float32Array, uvs: Float32Array, indices: Uint16Array }}
 */
function buildTileMesh(tileBbox, tileCrs, plotCrs, N) {
  const sameProj = `EPSG:${parseCrsCode(tileCrs)}` === `EPSG:${parseCrsCode(plotCrs)}`
  const project = sameProj ? null : proj4(`EPSG:${parseCrsCode(tileCrs)}`, `EPSG:${parseCrsCode(plotCrs)}`).forward

  const numVerts = (N + 1) * (N + 1)
  const positions = new Float32Array(numVerts * 2)
  const uvs = new Float32Array(numVerts * 2)

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
      positions[vi * 2]     = px
      positions[vi * 2 + 1] = py
      uvs[vi * 2]     = u
      uvs[vi * 2 + 1] = 1 - v  // flip v: tile y=0 is top, GL texture v=0 is bottom
    }
  }

  // Two CCW triangles per cell: (BL, BR, TR) and (BL, TR, TL)
  const numIndices = N * N * 6
  const indices = new Uint16Array(numIndices)
  let idx = 0
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const bl = j * (N + 1) + i
      const br = bl + 1
      const tl = bl + (N + 1)
      const tr = tl + 1
      indices[idx++] = bl; indices[idx++] = br; indices[idx++] = tr
      indices[idx++] = bl; indices[idx++] = tr; indices[idx++] = tl
    }
  }

  return { positions, uvs, indices }
}

// ─── TileManager ──────────────────────────────────────────────────────────────

const MAX_TILE_CACHE = 50
const DOMAIN_CHANGE_THRESHOLD = 0.02  // 2% change triggers tile sync

class TileManager {
  constructor({ regl, source, tileCrs, plotCrs, tessellation, onLoad }) {
    this.regl = regl
    this.source = source
    this.tileCrs = tileCrs  // CRS of the tile service (e.g. "EPSG:3857")
    this.plotCrs = plotCrs  // CRS of the plot axes
    this.tessellation = tessellation
    this.onLoad = onLoad

    this.tiles = new Map()       // tileKey → tile entry
    this.accessOrder = []        // LRU tracking

    this._lastXDomain = null
    this._lastYDomain = null
    this._lastViewport = null

    // Pre-compute the proj4 converter from plotCrs to tileCrs for bbox conversion
    const fromCode = parseCrsCode(plotCrs)
    const toCode = parseCrsCode(tileCrs)
    this._plotToTile = fromCode === toCode
      ? (pt) => pt
      : proj4(`EPSG:${fromCode}`, `EPSG:${toCode}`).forward
  }

  _domainChanged(xDomain, yDomain, viewport) {
    if (!this._lastXDomain || !this._lastYDomain) return true
    const dx = Math.abs(xDomain[1] - xDomain[0])
    const dy = Math.abs(yDomain[1] - yDomain[0])
    const xChange = Math.max(
      Math.abs(xDomain[0] - this._lastXDomain[0]) / dx,
      Math.abs(xDomain[1] - this._lastXDomain[1]) / dx
    )
    const yChange = Math.max(
      Math.abs(yDomain[0] - this._lastYDomain[0]) / dy,
      Math.abs(yDomain[1] - this._lastYDomain[1]) / dy
    )
    const viewChanged = viewport && this._lastViewport && (
      viewport.width !== this._lastViewport.width ||
      viewport.height !== this._lastViewport.height
    )
    return xChange > DOMAIN_CHANGE_THRESHOLD || yChange > DOMAIN_CHANGE_THRESHOLD || viewChanged
  }

  _plotBboxToTileBbox(xDomain, yDomain) {
    // Reproject all four corners and take the axis-aligned bounding box
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
      // WMS: one image covering the full viewport
      const wmsUrl = buildWmsUrl(source, tileBbox, this.tileCrs, viewport.width, viewport.height)
      return [{ key: wmsUrl, bbox: tileBbox, url: wmsUrl, type: 'wms' }]
    }

    // XYZ / WMTS: standard tile grid
    const minZoom = source.minZoom ?? 0
    const maxZoom = source.maxZoom ?? 19
    const z = optimalZoom(tileBbox, viewport.width, minZoom, maxZoom)

    const [xMin, yMax] = mercToTileXY(tileBbox.minX, tileBbox.minY, z)  // note: minY → top tile
    const [xMax, yMin] = mercToTileXY(tileBbox.maxX, tileBbox.maxY, z)  // maxY → bottom tile
    // Clamp to valid tile range
    const tileCount = Math.pow(2, z)
    const txMin = Math.max(0, xMin)
    const txMax = Math.min(tileCount - 1, xMax)
    const tyMin = Math.max(0, yMin)
    const tyMax = Math.min(tileCount - 1, yMax)

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
    const neededKeys = new Set(needed.map(t => t.key))

    // Start loading tiles not yet in cache
    for (const tileSpec of needed) {
      if (!this.tiles.has(tileSpec.key)) {
        this._loadTile(tileSpec)
      }
    }

    // LRU eviction: remove oldest tiles beyond cache limit if they aren't currently needed
    if (this.tiles.size > MAX_TILE_CACHE) {
      for (const key of this.accessOrder) {
        if (!neededKeys.has(key) && this.tiles.has(key)) {
          this._evictTile(key)
          if (this.tiles.size <= MAX_TILE_CACHE) break
        }
      }
    }

    // Keep WMS cache small: evict old WMS images not in current set
    if (this.source.type === 'wms') {
      for (const key of [...this.tiles.keys()]) {
        if (!neededKeys.has(key)) this._evictTile(key)
      }
    }
  }

  _evictTile(key) {
    const tile = this.tiles.get(key)
    if (!tile) return
    if (tile.texture) tile.texture.destroy()
    if (tile.posBuffer) tile.posBuffer.destroy()
    if (tile.uvBuffer) tile.uvBuffer.destroy()
    if (tile.elements) tile.elements.destroy()
    this.tiles.delete(key)
    const i = this.accessOrder.indexOf(key)
    if (i >= 0) this.accessOrder.splice(i, 1)
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

      // Check we haven't been evicted while loading
      if (!this.tiles.has(tileSpec.key)) return

      const mesh = buildTileMesh(tileSpec.bbox, this.tileCrs, this.plotCrs, this.tessellation)
      const texture = this.regl.texture({ data: img, flipY: false, min: 'linear', mag: 'linear' })
      const posBuffer = this.regl.buffer(mesh.positions)
      const uvBuffer = this.regl.buffer(mesh.uvs)
      const elements = this.regl.elements({ data: mesh.indices, type: 'uint16' })

      this.tiles.set(tileSpec.key, {
        status: 'loaded',
        texture,
        posBuffer,
        uvBuffer,
        elements,
        indexCount: mesh.indices.length,
      })

      this.onLoad()
    } catch (err) {
      // Mark as failed so we don't retry endlessly (remove from cache to allow future retry on pan)
      this.tiles.delete(tileSpec.key)
      const i = this.accessOrder.indexOf(tileSpec.key)
      if (i >= 0) this.accessOrder.splice(i, 1)
      console.warn(`[TileLayer] ${err.message}`)
    }
  }

  get loadedTiles() {
    return [...this.tiles.values()].filter(t => t.status === 'loaded')
  }

  destroy() {
    for (const key of [...this.tiles.keys()]) {
      this._evictTile(key)
    }
  }
}

// ─── GLSL ─────────────────────────────────────────────────────────────────────

const TILE_VERT = `
  precision mediump float;
  attribute vec2 position;
  attribute vec2 uv;
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  varying vec2 vUv;

  float normalize_axis(float v, vec2 domain, float scaleType) {
    float vt = scaleType > 0.5 ? log(v) : v;
    float d0 = scaleType > 0.5 ? log(domain.x) : domain.x;
    float d1 = scaleType > 0.5 ? log(domain.y) : domain.y;
    return (vt - d0) / (d1 - d0);
  }

  void main() {
    float nx = normalize_axis(position.x, xDomain, xScaleType);
    float ny = normalize_axis(position.y, yDomain, yScaleType);
    gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
    vUv = uv;
  }
`

const TILE_FRAG = `
  precision mediump float;
  uniform sampler2D tileTexture;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tileTexture, vUv);
    gl_FragColor = vec4(color.rgb, color.a * opacity);
  }
`

// ─── TileLayerType ────────────────────────────────────────────────────────────

class TileLayerType extends LayerType {
  constructor() {
    super({ name: 'tile' })
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
      colorAxisQuantityKinds: [],
      filterAxisQuantityKinds: [],
    }
  }

  createLayer(parameters, _data) {
    const {
      xAxis = 'xaxis_bottom',
      yAxis = 'yaxis_left',
      plotCrs,
      tileCrs,
    } = parameters
    const effectiveTileCrs = tileCrs ?? 'EPSG:3857'
    const effectivePlotCrs = plotCrs ?? effectiveTileCrs

    // Return a plain object: compatible with the render loop but no Float32Array required.
    return [{
      type: this,
      xAxis,
      yAxis,
      xAxisQuantityKind: crsToQkX(effectivePlotCrs),
      yAxisQuantityKind: crsToQkY(effectivePlotCrs),
      colorAxes: [],
      filterAxes: [],
      vertexCount: 0,
      instanceCount: null,
      attributes: {},
      domains: {},
      uniforms: {},
      parameters,
    }]
  }

  createDrawCommand(regl, layer, plot) {
    const {
      source: sourceSpec,
      tileCrs,
      plotCrs,
      tessellation = 8,
      opacity = 1.0,
    } = layer.parameters
    const source = resolveSource(sourceSpec)
    const effectiveTileCrs = tileCrs ?? 'EPSG:3857'
    const effectivePlotCrs = plotCrs ?? effectiveTileCrs

    // Create the regl draw command immediately — it doesn't need CRS info
    const drawTile = regl({
      vert: TILE_VERT,
      frag: TILE_FRAG,
      attributes: {
        position: regl.prop('posBuffer'),
        uv: regl.prop('uvBuffer'),
      },
      elements: regl.prop('elements'),
      uniforms: {
        xDomain: regl.prop('xDomain'),
        yDomain: regl.prop('yDomain'),
        xScaleType: regl.prop('xScaleType'),
        yScaleType: regl.prop('yScaleType'),
        tileTexture: regl.prop('texture'),
        opacity: opacity,
      },
      viewport: regl.prop('viewport'),
      blend: {
        enable: true,
        func: { src: 'src alpha', dst: 'one minus src alpha' },
      },
      depth: { enable: false },
    })

    // TileManager is created once both CRS definitions are ready.
    // Renders nothing until then; scheduleRender() triggers a repaint once ready.
    let tileManager = null

    Promise.all([
      ensureCrsDefined(effectiveTileCrs),
      ensureCrsDefined(effectivePlotCrs),
    ]).then(() => {
      try {
        tileManager = new TileManager({
          regl,
          source,
          tileCrs: effectiveTileCrs,
          plotCrs: effectivePlotCrs,
          tessellation,
          onLoad: () => plot.scheduleRender(),
        })
        plot.scheduleRender()
      } catch (_) {
        // regl may have been destroyed if the plot was updated before CRS resolved
      }
    }).catch(err => {
      console.error('[TileLayer] CRS initialization failed:', err)
    })

    return (props) => {
      if (!tileManager) return
      tileManager.syncTiles(props.xDomain, props.yDomain, props.viewport)
      for (const tile of tileManager.loadedTiles) {
        drawTile({
          xDomain: props.xDomain,
          yDomain: props.yDomain,
          xScaleType: props.xScaleType,
          yScaleType: props.yScaleType,
          viewport: props.viewport,
          posBuffer: tile.posBuffer,
          uvBuffer: tile.uvBuffer,
          elements: tile.elements,
          texture: tile.texture,
        })
      }
    }
  }
}

export const tileLayerType = new TileLayerType()
registerLayerType('tile', tileLayerType)

export { TileLayerType }
