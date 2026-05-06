import proj4 from 'proj4'
import { LayerType } from '../../core/LayerType.js'
import { ColumnData } from '../../data/ColumnData.js'
import { AXES } from '../../axes/AxisRegistry.js'
import { parseCrsCode, crsToQkX, crsToQkY, ensureCrsDefined } from '../../geo/EpsgUtils.js'
import {
  resolveSource, makeSourceSchema, SAT_PRESETS, DTM_PRESETS,
  buildQuantizedMeshUrl, geographicToTileXY, tileToGeographicBbox, optimalZoomGeographic,
} from './TileLayer.js'
import { SatTileCache, TERRAIN_FRAG } from './ImageTerrainImpl.js'
import { parseQuantizedMesh } from './QuantizedMesh.js'

const MAX_TILE_CACHE = 50
const DOMAIN_CHANGE_THRESHOLD = 0.02

// ─── SyncColumn ───────────────────────────────────────────────────────────────
// Minimal ColumnData that triggers syncFn each render frame via refresh().
// Added to layer._dataColumns so Plot.js calls it every frame.

class SyncColumn extends ColumnData {
  constructor(syncFn) {
    super()
    this._syncFn = syncFn
  }
  get length() { return 1 }
  get shape()  { return [1] }
  resolve(_path, _regl) { return { glslExpr: '0.0', textures: {}, shape: [1] } }
  toTexture()  { return null }
  async refresh(plot) {
    this._syncFn(plot)
    return false
  }
}

// ─── QM vertex shader ─────────────────────────────────────────────────────────
// Direct vertex attributes replace the column-texture sampling used by ImageTerrainImpl.
// plot_pos_3d, spatial uniforms, a_pickId, v_pickId, gladly_apply_color, fragColor
// are all injected by LayerType.prototype.createDrawCommand via the super call.

const QM_TERRAIN_VERT = `#version 300 es
precision highp float;

in float a_x_pos;
in float a_z_pos;
in float a_elevation;
in float a_sat_uv_x;
in float a_sat_uv_y;

out vec2 v_sat_uv;

void main() {
  gl_Position = plot_pos_3d(vec3(a_x_pos, a_elevation, a_z_pos));
  v_sat_uv = vec2(a_sat_uv_x, a_sat_uv_y);
}
`

// ─── QmTileManager ────────────────────────────────────────────────────────────

class QmTileManager {
  constructor({ regl, source, plotCrs, satTileCrs, satCacheRef, onLoad }) {
    this.regl = regl
    this.source = source
    this.plotCrs = plotCrs
    this.satTileCrs = satTileCrs
    this._satCacheRef = satCacheRef
    this.onLoad = onLoad

    this.tiles = new Map()
    this.accessOrder = []
    this._neededKeys = new Set()

    this._lastXDomain = null
    this._lastYDomain = null
    this._lastViewport = null

    const plotCode = parseCrsCode(plotCrs)
    const satCode  = parseCrsCode(satTileCrs)

    this._geoToPlot = plotCode === 4326
      ? (pt) => pt
      : proj4('EPSG:4326', `EPSG:${plotCode}`).forward
    this._geoToSat  = satCode  === 4326
      ? (pt) => pt
      : proj4('EPSG:4326', `EPSG:${satCode}`).forward
    this._plotToGeo = plotCode === 4326
      ? (pt) => pt
      : proj4(`EPSG:${plotCode}`, 'EPSG:4326').forward
  }

  _domainChanged(xDomain, yDomain, viewport) {
    if (!this._lastXDomain) return true
    const viewChanged = !!(viewport && this._lastViewport && (
      viewport.width !== this._lastViewport.width || viewport.height !== this._lastViewport.height
    ))
    if (viewChanged) return true
    const dx = Math.abs(xDomain[1] - xDomain[0])
    const dy = Math.abs(yDomain[1] - yDomain[0])
    if (dx === 0 || dy === 0) {
      return xDomain[0] !== this._lastXDomain[0] || xDomain[1] !== this._lastXDomain[1] ||
             yDomain[0] !== this._lastYDomain[0] || yDomain[1] !== this._lastYDomain[1]
    }
    const xChange = Math.max(
      Math.abs(xDomain[0] - this._lastXDomain[0]) / dx,
      Math.abs(xDomain[1] - this._lastXDomain[1]) / dx
    )
    const yChange = Math.max(
      Math.abs(yDomain[0] - this._lastYDomain[0]) / dy,
      Math.abs(yDomain[1] - this._lastYDomain[1]) / dy
    )
    return xChange > DOMAIN_CHANGE_THRESHOLD || yChange > DOMAIN_CHANGE_THRESHOLD
  }

  _plotBboxToGeoBbox(xDomain, yDomain) {
    const corners = [
      [xDomain[0], yDomain[0]], [xDomain[1], yDomain[0]],
      [xDomain[0], yDomain[1]], [xDomain[1], yDomain[1]],
    ].flatMap(pt => {
      try {
        const [lon, lat] = this._plotToGeo(pt)
        return isFinite(lon) && isFinite(lat) ? [{ lon, lat }] : []
      } catch { return [] }
    })

    if (corners.length === 0) return null
    return {
      west:  Math.max(-180, Math.min(180, Math.min(...corners.map(c => c.lon)))),
      east:  Math.max(-180, Math.min(180, Math.max(...corners.map(c => c.lon)))),
      south: Math.max(-90,  Math.min(90,  Math.min(...corners.map(c => c.lat)))),
      north: Math.max(-90,  Math.min(90,  Math.max(...corners.map(c => c.lat)))),
    }
  }

  _computeNeededTiles(xDomain, yDomain, viewport) {
    const geoBbox = this._plotBboxToGeoBbox(xDomain, yDomain)
    if (!geoBbox) return []

    const source = this.source
    const minZoom = source.minZoom ?? 0
    const maxZoom = source.maxZoom ?? 13
    const z = optimalZoomGeographic(geoBbox, viewport.width, viewport.height, minZoom, maxZoom)

    const [txMin, tyMin] = geographicToTileXY(geoBbox.west,  geoBbox.south, z)
    const [txMax, tyMax] = geographicToTileXY(geoBbox.east,  geoBbox.north, z)

    if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 64) {
      console.warn('[QmTileManager] tile range too large, skipping')
      return []
    }

    const tiles = []
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const url  = buildQuantizedMeshUrl(source, z, tx, ty)
        const bbox = tileToGeographicBbox(tx, ty, z)
        tiles.push({ key: `qm:${z}/${tx}/${ty}`, z, x: tx, y: ty, url, bbox })
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
      if (tile.status !== 'loaded') continue
      satCache.requestForBbox(tile.satCrsBbox, viewport)
    }
  }

  // Update sat UV buffers for tiles whose best sat tile has changed.
  // Called each frame from syncFn so UV buffers stay current.
  updateSatUvs() {
    const satCache = this._satCacheRef.cache
    if (!satCache) return

    for (const tile of this.tiles.values()) {
      if (tile.status !== 'loaded') continue
      const sat = satCache.getBestAvailable(tile.satCrsBbox)
      if (!sat || sat.key === tile.lastSatKey) continue

      const n = tile.satXArr.length
      const uvXArr = new Float32Array(n)
      const uvYArr = new Float32Array(n)
      const bW = sat.bounds.maxX - sat.bounds.minX
      const bH = sat.bounds.maxY - sat.bounds.minY
      for (let i = 0; i < n; i++) {
        uvXArr[i] = (tile.satXArr[i] - sat.bounds.minX) / bW
        uvYArr[i] = 1.0 - (tile.satYArr[i] - sat.bounds.minY) / bH
      }
      tile.satUvXBuf?.destroy()
      tile.satUvYBuf?.destroy()
      tile.satUvXBuf = this.regl.buffer({ data: uvXArr, type: 'float' })
      tile.satUvYBuf = this.regl.buffer({ data: uvYArr, type: 'float' })
      tile.satTex    = sat.texture
      tile.lastSatKey = sat.key
    }
  }

  // Returns all loaded tiles that have sat UV buffers ready to draw.
  getLoadedTiles() {
    return [...this.tiles.values()].filter(t => t.status === 'loaded' && t.satUvXBuf)
  }

  async _loadTile(spec) {
    this.tiles.set(spec.key, { status: 'loading' })
    this.accessOrder.push(spec.key)

    try {
      const response = await fetch(spec.url)
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${spec.url}`)
      const buffer = await response.arrayBuffer()

      if (!this.tiles.has(spec.key)) return  // evicted while loading

      const { triangleCount, indices, u: uArr, v: vArr, elevation: elevArr } =
        parseQuantizedMesh(buffer)
      const vertCount = triangleCount * 3
      const { west, east, south, north } = spec.bbox

      // Expand indexed mesh to flat (non-indexed) triangles + project to plot/sat CRS.
      const xArr    = new Float32Array(vertCount)
      const zArr    = new Float32Array(vertCount)
      const elArr   = new Float32Array(vertCount)
      const satXArr = new Float32Array(vertCount)
      const satYArr = new Float32Array(vertCount)

      for (let i = 0; i < vertCount; i++) {
        const vi  = indices[i]
        const lon = west  + uArr[vi] * (east  - west)
        const lat = south + vArr[vi] * (north - south)
        elArr[i] = elevArr[vi]
        const [px, py] = this._geoToPlot([lon, lat])
        xArr[i] = px
        zArr[i] = py
        const [sx, sy] = this._geoToSat([lon, lat])
        satXArr[i] = sx
        satYArr[i] = sy
      }

      let mnSX = Infinity, mxSX = -Infinity, mnSY = Infinity, mxSY = -Infinity
      for (let i = 0; i < vertCount; i++) {
        if (satXArr[i] < mnSX) mnSX = satXArr[i]
        if (satXArr[i] > mxSX) mxSX = satXArr[i]
        if (satYArr[i] < mnSY) mnSY = satYArr[i]
        if (satYArr[i] > mxSY) mxSY = satYArr[i]
      }
      const satCrsBbox = { minX: mnSX, maxX: mxSX, minY: mnSY, maxY: mxSY }

      if (this.tiles.size > MAX_TILE_CACHE) {
        for (const k of this.accessOrder) {
          if (k !== spec.key && !this._neededKeys.has(k) && this.tiles.has(k)) {
            this._evictTile(k)
            if (this.tiles.size <= MAX_TILE_CACHE) break
          }
        }
      }

      this.tiles.set(spec.key, {
        status: 'loaded',
        triangleCount,
        xBuf:   this.regl.buffer({ data: xArr,  type: 'float' }),
        zBuf:   this.regl.buffer({ data: zArr,  type: 'float' }),
        elevBuf: this.regl.buffer({ data: elArr, type: 'float' }),
        satXArr, satYArr, satCrsBbox,
        lastSatKey: null,
        satUvXBuf: null,
        satUvYBuf: null,
        satTex:    null,
      })
      this.onLoad()
    } catch (err) {
      this.tiles.delete(spec.key)
      const i = this.accessOrder.indexOf(spec.key)
      if (i >= 0) this.accessOrder.splice(i, 1)
      console.warn(`[QmTerrainImpl] ${err.message}`)
    }
  }

  _evictTile(key) {
    const tile = this.tiles.get(key)
    if (!tile) return
    tile.xBuf?.destroy()
    tile.zBuf?.destroy()
    tile.elevBuf?.destroy()
    tile.satUvXBuf?.destroy()
    tile.satUvYBuf?.destroy()
    this.tiles.delete(key)
    const i = this.accessOrder.indexOf(key)
    if (i >= 0) this.accessOrder.splice(i, 1)
  }

  destroy() {
    for (const key of [...this.tiles.keys()]) this._evictTile(key)
  }
}

// ─── QmTerrainImpl ────────────────────────────────────────────────────────────
// Quantized-mesh terrain implementation: renders irregular triangle meshes from
// binary .terrain tiles. Not registered directly; used by TerrainTileLayerType shell.

const QM_DTM_SOURCE_SCHEMA = makeSourceSchema(DTM_PRESETS, { includeEncoding: false })
const QM_SAT_SOURCE_SCHEMA = makeSourceSchema(SAT_PRESETS)

export class QmTerrainImpl extends LayerType {
  constructor() {
    super({ name: 'terrain-qm', vert: QM_TERRAIN_VERT, frag: TERRAIN_FRAG, suppressWarnings: true })
  }

  schema(_data) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        dtmSource:    { ...QM_DTM_SOURCE_SCHEMA, description: 'Quantized-mesh terrain tile source.' },
        satSource:    { ...QM_SAT_SOURCE_SCHEMA, description: 'Satellite/imagery tile source draped over terrain.' },
        plotCrs:      { type: 'string', description: 'CRS of the x/z plot axes. Defaults to EPSG:3857.' },
        opacity:      { type: 'number', default: 1.0, minimum: 0, maximum: 1 },
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
    } = parameters
    const effectivePlotCrs = plotCrs ?? 'EPSG:3857'
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
      plotCrs,
      dtmSource: dtmSourceSpec,
      satSource: satSourceSpec,
      opacity = 1.0,
    } = parameters

    const axisConfig = this.resolveAxisConfig(parameters, _data)
    const dtmSource  = resolveSource(dtmSourceSpec)
    const satSource  = resolveSource(satSourceSpec)

    const effectivePlotCrs    = plotCrs ?? 'EPSG:3857'
    const effectiveSatTileCrs = satSource.crs ?? 'EPSG:3857'

    const qmManagerRef = { manager: null }
    const satCacheRef  = { cache: null }

    const syncFn = (renderPlot) => {
      if (!qmManagerRef.manager) return
      const xScale = renderPlot.axisRegistry.getScale(xAxis)
      const zScale = renderPlot.axisRegistry.getScale(zAxis)
      if (!xScale || !zScale) return
      const viewport = { width: renderPlot.canvas.width, height: renderPlot.canvas.height }
      qmManagerRef.manager.syncTiles(xScale.domain(), zScale.domain(), viewport)
      qmManagerRef.manager.requestSatTiles(viewport)
      qmManagerRef.manager.updateSatUvs()
    }

    const syncCol = new SyncColumn(syncFn)

    Promise.all([
      ensureCrsDefined(effectivePlotCrs),
      ensureCrsDefined(effectiveSatTileCrs),
    ]).then(() => {
      try {
        qmManagerRef.manager = new QmTileManager({
          regl, source: dtmSource,
          plotCrs:    effectivePlotCrs,
          satTileCrs: effectiveSatTileCrs,
          satCacheRef,
          onLoad: () => plot.scheduleRender(),
        })
        satCacheRef.cache = new SatTileCache({
          regl, source: satSource,
          satTileCrs: effectiveSatTileCrs,
          onLoad: () => {
            qmManagerRef.manager?.updateSatUvs()
            plot.scheduleRender()
          },
        })
        plot.scheduleRender()
      } catch (_) {}
    }).catch(err => {
      console.error('[QmTerrainImpl] CRS initialization failed:', err)
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
      vertexCount:  1,
      primitive:    'triangles',
      lineWidth:    1,
      instanceCount: null,
      attributeDivisors: {},
      attributes:   {},
      uniforms:     {},
      domains:      {},
      parameters,
      _syncColumn:  syncCol,
      _qmManager:   qmManagerRef,
      _opacity:     opacity,
    }]
  }

  async createDrawCommand(regl, layer, plot) {
    // Call super with a proxy layer (empty attributes, vertexCount=1) to get
    // all spatial GLSL injection (plot_pos_3d, uniforms, a_pickId, v_pickId, etc.)
    // without any column system involvement.
    const proxyLayer = {
      ...layer,
      attributes: {},
      vertexCount: 1,
      uniforms: {},
      blend: null,
      colorAxes: {},
      colorAxes2d: {},
      filterAxes: {},
      instanceCount: null,
    }
    const drawConfig = await LayerType.prototype.createDrawCommand.call(this, regl, proxyLayer, plot)

    // Transfer _dataColumns from proxy layer and append the SyncColumn so
    // Plot.js calls syncFn (→ tile manager) every render frame.
    layer._dataColumns = [...(proxyLayer._dataColumns ?? []), layer._syncColumn]

    // Compile a reusable draw command with per-tile props passed dynamically.
    // a_pickId is overridden with a constant so the fixed-size proxy buffer doesn't mismatch
    // the variable vertex count in each QM tile.
    const compiledDraw = regl({
      ...drawConfig,
      attributes: {
        a_pickId:    { constant: [0] },
        a_x_pos:     regl.prop('xBuf'),
        a_z_pos:     regl.prop('zBuf'),
        a_elevation: regl.prop('elevBuf'),
        a_sat_uv_x:  regl.prop('satUvXBuf'),
        a_sat_uv_y:  regl.prop('satUvYBuf'),
      },
      uniforms: {
        ...drawConfig.uniforms,
        u_sat_tex: regl.prop('satTex'),
        u_opacity: regl.prop('opacity'),
      },
      count:  regl.prop('count'),
      depth:  { enable: true },
      blend:  { enable: false },
    })

    const qmManagerRef = layer._qmManager
    const opacity = layer._opacity

    // Return a function: Plot.js passes runtimeProps (spatial uniforms, pick state, etc.)
    // and we call compiledDraw once per loaded QM tile with tile-specific props overriding count.
    return (runtimeProps) => {
      const qmManager = qmManagerRef.manager
      if (!qmManager) return
      for (const tile of qmManager.getLoadedTiles()) {
        compiledDraw({
          ...runtimeProps,
          count:     tile.triangleCount * 3,
          xBuf:      tile.xBuf,
          zBuf:      tile.zBuf,
          elevBuf:   tile.elevBuf,
          satUvXBuf: tile.satUvXBuf,
          satUvYBuf: tile.satUvYBuf,
          satTex:    tile.satTex,
          opacity,
        })
      }
    }
  }
}
