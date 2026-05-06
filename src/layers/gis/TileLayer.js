import proj4 from 'proj4'
import { LayerType } from '../../core/LayerType.js'
import { ColumnData, uploadToTexture } from '../../data/ColumnData.js'
import { AXES } from '../../axes/AxisRegistry.js'
import { registerLayerType } from '../../core/LayerTypeRegistry.js'
import { parseCrsCode, crsToQkX, crsToQkY, ensureCrsDefined } from '../../geo/EpsgUtils.js'

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

// ─── Geographic tile math (Cesium WGS84 scheme) ───────────────────────────────
// At zoom z: 2^(z+1) columns × 2^z rows covering [-180,180] × [-90,90].
// y=0 is south (TMS convention), matching quantized-mesh tile servers.

export function geographicToTileXY(lon, lat, z) {
  const cols = Math.pow(2, z + 1)
  const rows = Math.pow(2, z)
  return [
    Math.max(0, Math.min(cols - 1, Math.floor((lon + 180) / (360 / cols)))),
    Math.max(0, Math.min(rows - 1, Math.floor((lat + 90)  / (180 / rows)))),
  ]
}

export function tileToGeographicBbox(tx, ty, z) {
  const cols = Math.pow(2, z + 1)
  const rows = Math.pow(2, z)
  const colWidth  = 360 / cols
  const rowHeight = 180 / rows
  return {
    west:  -180 + tx       * colWidth,
    east:  -180 + (tx + 1) * colWidth,
    south:  -90 + ty       * rowHeight,
    north:  -90 + (ty + 1) * rowHeight,
  }
}

// Compute optimal zoom for the geographic tiling scheme.
// lonExtent / latExtent are in degrees; viewport in pixels.
export function optimalZoomGeographic(bboxInDegrees, pixelWidth, pixelHeight, minZoom, maxZoom) {
  const lonExtent = Math.abs(bboxInDegrees.east  - bboxInDegrees.west)
  const latExtent = Math.abs(bboxInDegrees.north - bboxInDegrees.south)
  // At zoom z: column width = 360 / 2^(z+1), so z = log2(px*360/(256*lon)) - 1
  const zx = lonExtent > 0 ? Math.log2(pixelWidth  * 360 / (256 * lonExtent)) - 1 : Infinity
  // At zoom z: row height = 180 / 2^z,        so z = log2(px*180/(256*lat))
  const zy = latExtent > 0 ? Math.log2(pixelHeight * 180 / (256 * latExtent))     : Infinity
  const z = Math.min(zx, zy)
  return Math.min(Math.max(Math.floor(isFinite(z) ? z : maxZoom), minZoom), maxZoom)
}

// ─── Source resolution ────────────────────────────────────────────────────────

export function resolveSource(source) {
  const type = Object.keys(source).find(k =>
    k === 'xyz' || k === 'wms' || k === 'wmts' || k === 'cog' || k === 'cogTiles' || k === 'quantizedMesh'
  )
  if (!type) throw new Error(`source must have exactly one key of: xyz, wms, wmts, cog, cogTiles, quantizedMesh`)
  return { type, ...source[type] }
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const SAT_PRESETS = [
  {
    title: 'OpenStreetMap (preset)',
    source: { xyz: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c'], maxZoom: 19, crs: 'EPSG:3857' } },
  },
  {
    title: 'ESRI World Imagery (preset)',
    // ArcGIS tile path order is z/row/col — buildXyzUrl substitutes {x}=col {y}=row by name, so this is correct.
    source: { xyz: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, crs: 'EPSG:3857' } },
  },
  {
    title: 'EOX Sentinel-2 Cloudless 2024 WMTS (preset)',
    // 10 m global annual composite, CC BY-NC-SA 4.0. RESTful WMTS: {z}/{y}/{x} = TileMatrix/TileRow/TileCol.
    source: { wmts: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg', layer: 's2cloudless-2024_3857', tileMatrixSet: 'g', format: 'image/jpeg', maxZoom: 14, crs: 'EPSG:3857' } },
  },
  {
    title: 'USGS Imagery Only WMTS (preset)',
    // ~1 m NAIP aerial imagery for CONUS; 15 m elsewhere.
    source: { wmts: { url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS', layer: 'USGSImageryOnly', tileMatrixSet: 'GoogleMapsCompatible', format: 'image/jpeg', crs: 'EPSG:3857' } },
  },
  {
    title: 'NASA GIBS Blue Marble WMS (preset)',
    source: { wms: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', layers: 'BlueMarble_NextGeneration', format: 'image/jpeg', transparent: false, version: '1.1.1', crs: 'EPSG:3857' } },
  },
  {
    title: 'NASA GIBS MODIS NDVI 8-Day (preset)',
    // NDVI vegetation index, 250 m, most-recent 8-day composite (omitting TIME returns latest).
    source: { wms: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', layers: 'MODIS_Terra_NDVI_8Day', format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857' } },
  },
  {
    title: 'NASA GIBS MODIS Land Surface Temp (preset)',
    // Daytime land surface temperature, 1 km (latest available date when TIME is omitted).
    source: { wms: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', layers: 'MODIS_Terra_Land_Surface_Temp_Day', format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857' } },
  },
  {
    title: 'NASA GIBS MODIS Chlorophyll-A (preset)',
    // Ocean chlorophyll-a concentration, 4 km (latest available date when TIME is omitted).
    source: { wms: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', layers: 'MODIS_Terra_Chlorophyll_A', format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857' } },
  },
  {
    title: 'NASA GIBS VIIRS Night Lights (preset)',
    // Day/Night Band nighttime lights, ~500 m (latest available date when TIME is omitted).
    source: { wms: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', layers: 'VIIRS_SNPP_DayNightBand_ENCC', format: 'image/jpeg', transparent: false, version: '1.1.1', crs: 'EPSG:3857' } },
  },
  {
    title: 'USGS National Map Topo WMTS (preset)',
    source: { wmts: { url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS', layer: 'USGSTopo', tileMatrixSet: 'GoogleMapsCompatible', format: 'image/jpeg', crs: 'EPSG:3857' } },
  },
  {
    title: 'GEBCO Bathymetry WMS (preset)',
    // Global ocean + land relief, ~450 m. CRS EPSG:4326 — axis swap handled by buildWmsUrl for WMS 1.3.0.
    source: { wms: { url: 'https://wms.gebco.net/mapserv', layers: 'gebco_latest', format: 'image/png', version: '1.3.0', transparent: false, crs: 'EPSG:4326' } },
  },
]

export const DTM_PRESETS = [
  {
    title: 'AWS Open Terrain — terrarium (preset)',
    source: { xyz: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', maxZoom: 15, encoding: 'terrarium', crs: 'EPSG:3857' } },
  },
  {
    title: 'Mapbox Terrain-RGB (preset)',
    source: { xyz: { url: 'https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=TOKEN', maxZoom: 15, encoding: 'mapbox', crs: 'EPSG:3857' } },
  },
  {
    title: 'MapTiler Terrain (preset)',
    source: { xyz: { url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=KEY', maxZoom: 15, encoding: 'mapbox', crs: 'EPSG:3857' } },
  },
  {
    title: 'USGS 3DEP WMS — grayscale (preset)',
    source: { wms: { url: 'https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WMSServer', layers: '3DEPElevation', format: 'image/png', version: '1.3.0', transparent: false, encoding: 'grayscale', crs: 'EPSG:3857' } },
  },
  {
    title: 'USGS 3DEP WMTS — grayscale (preset)',
    source: { wmts: { url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WMTS', layer: '3DEPElevation', tileMatrixSet: 'GoogleMapsCompatible', format: 'image/png', encoding: 'grayscale', crs: 'EPSG:3857' } },
  },
  {
    title: 'Cesium World Terrain (preset)',
    // Requires a Cesium Ion access token — replace TOKEN with your token from cesium.com/ion.
    source: { quantizedMesh: { url: 'https://assets.cesium.com/1/{z}/{x}/{y}.terrain?v=1.2.0&extensions=octvertexnormals-watermask-metadata&access_token=TOKEN', maxZoom: 15, crs: 'EPSG:4326' } },
  },
  {
    title: 'MapTiler Terrain QM (preset)',
    // Requires a MapTiler API key — replace KEY with your key from maptiler.com.
    source: { quantizedMesh: { url: 'https://api.maptiler.com/tiles/terrain-quantized-mesh/{z}/{x}/{y}.terrain?key=KEY', maxZoom: 12, crs: 'EPSG:4326' } },
  },
  // Disabled: public COG elevation datasets lack CORS headers for browser fetch.
  // Uncomment and supply a CORS-enabled URL (self-hosted or proxied) to use cogTiles.
  // {
  //   title: 'Copernicus GLO-30 COG collection (preset)',
  //   source: { cogTiles: { url: 'https://elevationeuwest.blob.core.windows.net/copernicus-dem/COP30_hh/Copernicus_DSM_COG_10_{NS}{latAbs2}_00_{EW}{lonAbs3}_00_DEM.tif', encoding: 'float32', crs: 'EPSG:4326' } },
  // },
  // {
  //   title: 'OpenTopography SRTM GL1 COG collection (preset)',
  //   source: { cogTiles: { url: 'https://opentopography.s3.sdsc.edu/raster/SRTMGL1/SRTMGL1_{NS}{latAbs2}{EW}{lonAbs3}.tif', encoding: 'float32', crs: 'EPSG:4326' } },
  // },
]

// ─── Source schema builder ─────────────────────────────────────────────────────
// Base protocol alternatives (XYZ / WMS / WMTS) come first so editors that
// match anyOf by first-valid always resolve to the bare protocol name rather
// than a preset name for existing data.  Preset alternatives follow, providing
// named defaults for one-click setup.

export function makeSourceSchema(presets, { includeEncoding = false } = {}) {
  const crsProp = {
    crs: {
      type: 'string',
      default: 'EPSG:3857',
      description: 'CRS of the tile service (XYZ/WMTS: tile grid CRS; WMS: SRS/CRS parameter).',
      examples: ['EPSG:3857', 'EPSG:4326'],
    },
  }
  const encodingProp = includeEncoding ? {
    encoding: {
      type: 'string',
      enum: ['terrarium', 'mapbox', 'grayscale', 'float32'],
      default: 'terrarium',
      description: 'Elevation encoding. terrarium: AWS RGB (R×256+G+B/256−32768 m). mapbox: Mapbox/MapTiler RGB. grayscale: single-channel 0–1 (calibrate yAxis). float32: native float metres (COG only).',
    },
  } : {}
  const extra = { ...crsProp, ...encodingProp }

  const xyzProps = {
    url:        { type: 'string', description: 'URL template with {z}, {x}, {y}, optional {s}' },
    subdomains: { type: 'array', items: { type: 'string' }, default: ['a', 'b', 'c'] },
    minZoom:    { type: 'integer', default: 0 },
    maxZoom:    { type: 'integer', default: 19 },
    ...extra,
  }
  const wmsProps = {
    url:         { type: 'string', description: 'WMS service base URL' },
    layers:      { type: 'string', description: 'Comma-separated layer names' },
    styles:      { type: 'string', default: '', description: 'Comma-separated style names (optional)' },
    format:      { type: 'string', default: 'image/png' },
    version:     { type: 'string', enum: ['1.1.1', '1.3.0'], default: '1.1.1' },
    transparent: { type: 'boolean', default: false },
    ...extra,
  }
  const wmtsProps = {
    url:           { type: 'string', description: 'WMTS base URL (RESTful template or KVP endpoint)' },
    layer:         { type: 'string' },
    style:         { type: 'string', default: 'default' },
    format:        { type: 'string', default: 'image/png' },
    tileMatrixSet: { type: 'string', default: 'GoogleMapsCompatible' },
    minZoom:       { type: 'integer', default: 0 },
    maxZoom:       { type: 'integer', default: 19 },
    ...extra,
  }
  const qmProps = {
    url:     { type: 'string', description: 'URL template with {z}, {x}, {y}' },
    minZoom: { type: 'integer', default: 0 },
    maxZoom: { type: 'integer', default: 13 },
    crs:     { type: 'string', default: 'EPSG:4326', description: 'CRS of the quantized-mesh tile scheme. Standard servers use EPSG:4326.' },
  }

  const makeAlt = (title, type, props, required, defaultVal) => ({
    title,
    properties: {
      [type]: { type: 'object', properties: props, required, ...(defaultVal ? { default: defaultVal } : {}) },
    },
    required: [type],
    additionalProperties: false,
  })

  const cogCrs = { type: 'string', default: 'EPSG:4326', description: 'CRS of the COG. Use detectCogCrs(url) to auto-detect.', examples: ['EPSG:4326', 'EPSG:32632'] }
  const cogProps = {
    url: { type: 'string', description: 'URL to a Cloud Optimized GeoTIFF (.tif / .tiff)' },
    ...extra,
    crs: cogCrs,
  }
  const cogTilesProps = {
    url: { type: 'string', description: 'URL template. Variables: {NS}, {EW}, {latAbs2} (2-digit), {lonAbs3} (3-digit), {lat}, {lon}.' },
    tileWidth:  { type: 'number', default: 1, description: 'Longitude extent per tile (degrees).' },
    tileHeight: { type: 'number', default: 1, description: 'Latitude extent per tile (degrees).' },
    ...extra,
    crs: cogCrs,
  }

  const baseAlts = [
    makeAlt('XYZ',             'xyz',           xyzProps,      ['url'],           null),
    makeAlt('WMS',             'wms',           wmsProps,      ['url', 'layers'], null),
    makeAlt('WMTS',            'wmts',          wmtsProps,     ['url', 'layer'],  null),
    makeAlt('COG',             'cog',           cogProps,      ['url'],           null),
    makeAlt('COG Tiles',       'cogTiles',      cogTilesProps, ['url'],           null),
    makeAlt('Quantized Mesh',  'quantizedMesh', qmProps,       ['url'],           null),
  ]

  const propsByType = {
    xyz: xyzProps, wms: wmsProps, wmts: wmtsProps,
    cog: cogProps, cogTiles: cogTilesProps, quantizedMesh: qmProps,
  }
  const requiredByType = {
    xyz: ['url'], wms: ['url', 'layers'], wmts: ['url'], cog: ['url'], cogTiles: ['url'], quantizedMesh: ['url'],
  }

  const presetAlts = presets.map(p => {
    const type = Object.keys(p.source)[0]
    return makeAlt(p.title, type, propsByType[type] ?? xyzProps, requiredByType[type] ?? ['url'], p.source[type])
  })

  return {
    type: 'object',
    description: 'Tile source. Exactly one of xyz, wms, wmts, cog, cogTiles, or quantizedMesh must be present.',
    anyOf: [...baseAlts, ...presetAlts],
    default: presets.length > 0 ? presets[0].source : undefined,
  }
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

// Builds a quantized-mesh tile URL. Uses TMS y convention (y=0 at south, matching Cesium).
export function buildQuantizedMeshUrl(source, z, x, y) {
  return source.url
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
}

// ─── COG helpers ──────────────────────────────────────────────────────────────

const _cogTiffCache = new Map()  // url → Promise<GeoTIFF>; module-level so layers share open tiffs

async function openCog(url) {
  if (!_cogTiffCache.has(url)) {
    const { fromUrl } = await import('geotiff')
    _cogTiffCache.set(url, fromUrl(url))
  }
  return _cogTiffCache.get(url)
}

// Builds a tile URL from a template. Variables: {NS} {EW} {lat} {lon} {latAbs2} {lonAbs3}.
// lat/lon are the SW corner of the tile (integer degrees).
export function buildCogTilesUrl(source, lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  const latAbs2 = String(Math.abs(lat)).padStart(2, '0')
  const lonAbs3 = String(Math.abs(lon)).padStart(3, '0')
  return source.url
    .replace(/{NS}/g, ns).replace(/{EW}/g, ew)
    .replace(/{lat}/g, lat).replace(/{lon}/g, lon)
    .replace(/{latAbs2}/g, latAbs2).replace(/{lonAbs3}/g, lonAbs3)
}

// Returns the EPSG code string embedded in a COG's GeoTIFF metadata, or 'EPSG:4326' as fallback.
export async function detectCogCrs(url) {
  const tiff = await openCog(url)
  const image = await tiff.getImage()
  const geoKeys = image.getGeoKeys()
  const code = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey
  return (code && code > 0 && code < 32767) ? `EPSG:${code}` : 'EPSG:4326'
}

// Fetches a region of a COG as a TypedArray resampled to outW×outH pixels.
// bboxInCogCrs must be in the COG's native CRS (same as source.crs).
// resampleMethod: 'bilinear' for imagery, 'nearest' for RGB-encoded DTM.
// Returns { data, width, height, bands, isFloat } or null if bbox is outside the COG.
export async function fetchCogData(source, bboxInCogCrs, outW, outH, resampleMethod = 'bilinear') {
  const tiff  = await openCog(source.url)
  const image = await tiff.getImage()
  const [origX, origY] = image.getOrigin()
  const [resX,  resY]  = image.getResolution()  // resY negative (raster top-down)
  const absResY = Math.abs(resY)
  const fullW   = image.getWidth()
  const fullH   = image.getHeight()

  // Map bbox (CRS coords, minY=south) to pixel window (top-down, y0=north row)
  const x0 = Math.round((bboxInCogCrs.minX - origX) / resX)
  const x1 = Math.round((bboxInCogCrs.maxX - origX) / resX)
  const y0 = Math.round((origY - bboxInCogCrs.maxY) / absResY)
  const y1 = Math.round((origY - bboxInCogCrs.minY) / absResY)

  const cx0 = Math.max(0, x0), cx1 = Math.min(fullW, x1)
  const cy0 = Math.max(0, y0), cy1 = Math.min(fullH, y1)
  if (cx0 >= cx1 || cy0 >= cy1) return null

  const rasters = await image.readRasters({
    window: [cx0, cy0, cx1, cy1],
    width: outW, height: outH,
    interleave: true,
    resampleMethod,
  })

  const bands = image.getSamplesPerPixel()
  const sf    = image.getSampleFormat()
  const isFloat = (Array.isArray(sf) ? sf[0] : sf) === 3

  return { data: rasters, width: outW, height: outH, bands, isFloat }
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

    if (source.type === 'cog') {
      const key = `cog:${tileBbox.minX.toFixed(1)},${tileBbox.minY.toFixed(1)},${tileBbox.maxX.toFixed(1)},${tileBbox.maxY.toFixed(1)}`
      return [{ key, bbox: tileBbox, type: 'cog', width: viewport.width, height: viewport.height }]
    }

    if (source.type === 'cogTiles') {
      if (!isFinite(tileBbox.minX) || !isFinite(tileBbox.maxX) ||
          !isFinite(tileBbox.minY) || !isFinite(tileBbox.maxY)) return []
      const tw = source.tileWidth  ?? 1
      const th = source.tileHeight ?? 1
      const lonMin = Math.floor(tileBbox.minX / tw) * tw
      const lonMax = Math.floor(tileBbox.maxX / tw) * tw
      const latMin = Math.floor(tileBbox.minY / th) * th
      const latMax = Math.floor(tileBbox.maxY / th) * th
      const nX = Math.round((lonMax - lonMin) / tw) + 1
      const nY = Math.round((latMax - latMin) / th) + 1
      if (nX * nY > 256) {
        console.warn(`[TileLayer] cogTiles range too large (${nX}×${nY}), skipping`)
        return []
      }
      // Scale per-tile fetch resolution down as tile count grows so total pixels stay ~constant.
      const tileRes = Math.max(32, Math.floor(256 / Math.sqrt(nX * nY)))
      const tiles = []
      for (let lat = latMin; lat <= latMax; lat += th) {
        for (let lon = lonMin; lon <= lonMax; lon += tw) {
          const url = buildCogTilesUrl(source, lat, lon)
          tiles.push({ key: `${url}@${tileRes}`, url, bbox: { minX: lon, maxX: lon + tw, minY: lat, maxY: lat + th }, type: 'cogTiles', width: tileRes, height: tileRes })
        }
      }
      return tiles
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
      let imgTex
      if (tileSpec.type === 'cog' || tileSpec.type === 'cogTiles') {
        const cogSource = tileSpec.type === 'cogTiles' ? { ...this.source, url: tileSpec.url } : this.source
        const result = await fetchCogData(cogSource, tileSpec.bbox, tileSpec.width, tileSpec.height)
        if (!this.tiles.has(tileSpec.key)) return
        if (!result) throw new Error(`COG fetch returned no data for tile ${tileSpec.key}`)
        const format = result.bands >= 4 ? 'rgba' : 'rgb'
        imgTex = this.regl.texture({ data: result.data, width: result.width, height: result.height, format, type: 'uint8', flipY: false, min: 'linear', mag: 'linear' })
      } else {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = () => reject(new Error(`Failed to load tile: ${tileSpec.url}`))
          img.src = tileSpec.url
        })
        if (!this.tiles.has(tileSpec.key)) return
        imgTex = this.regl.texture({ data: img, flipY: false, min: 'linear', mag: 'linear' })
      }

      const mesh = buildTileMesh(tileSpec.bbox, this.tileCrs, this.plotCrs, this.tessellation)

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
      if (this.source.type === 'wms' || this.source.type === 'cog') {
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
        source:       { ...makeSourceSchema(SAT_PRESETS), description: 'Tile source. crs is configured inside the source.' },
        plotCrs:      { type: 'string', description: 'CRS of the plot axes (e.g. "EPSG:26911"). Defaults to source crs.' },
        tessellation: { type: 'integer', default: 8, minimum: 1, description: 'Grid resolution (N×N quads per tile) for reprojection accuracy.' },
        opacity:      { type: 'number', default: 1.0, minimum: 0, maximum: 1 },
        xAxis: { type: 'string', enum: AXES.filter(a => a.includes('x')), default: 'xaxis_bottom' },
        yAxis: { type: 'string', enum: AXES.filter(a => a.includes('y')), default: 'yaxis_left' },
      },
      required: ['source'],
    }
  }

  resolveAxisConfig(parameters, _data) {
    const { xAxis = 'xaxis_bottom', yAxis = 'yaxis_left', plotCrs, source: sourceSpec } = parameters
    let tileCrs = 'EPSG:3857'
    try { tileCrs = resolveSource(sourceSpec).crs ?? 'EPSG:3857' } catch (_) {}
    const effectivePlotCrs = plotCrs ?? tileCrs
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
      source: sourceSpec,
      tessellation = 8,
      opacity = 1.0,
    } = parameters
    const source = resolveSource(sourceSpec)
    const effectiveTileCrs = source.crs ?? 'EPSG:3857'
    const effectivePlotCrs = plotCrs ?? effectiveTileCrs
    const N = tessellation
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
