import { Plot, registerAxisQuantityKind } from '../src/index.js'

registerAxisQuantityKind('city_index', {
  label: 'City',
  scale: 'linear',
  colorscale: 'plasma',
})

// 12 major world cities [lon, lat] in WGS84 degrees (EPSG:4326)
const cityCoords = [
  [-74.006,  40.714],  // New York
  [ -0.118,  51.509],  // London
  [139.691,  35.690],  // Tokyo
  [151.209, -33.868],  // Sydney
  [  2.349,  48.864],  // Paris
  [-43.173, -22.908],  // Rio de Janeiro
  [ 28.048, -26.204],  // Johannesburg
  [121.474,  31.228],  // Shanghai
  [-87.629,  41.878],  // Chicago
  [ 37.618,  55.751],  // Moscow
  [ 77.209,  28.614],  // New Delhi
  [ 18.424, -33.925],  // Cape Town
]

const lon      = new Float32Array(cityCoords.map(c => c[0]))
const lat      = new Float32Array(cityCoords.map(c => c[1]))
const cityIdx  = new Float32Array(cityCoords.map((_, i) => i))

// Data uses EPSG:4326 quantity kinds so it shares axes with the tile layer
const data = {
  data: { lon, lat, cityIdx },
  quantity_kinds: {
    lon:     'epsg_4326_x',
    lat:     'epsg_4326_y',
    cityIdx: 'city_index',
  },
}

{
  const panel = document.createElement('div')
  panel.id = 'tab4'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Map tile underlay — OSM XYZ (EPSG:3857) reprojected to WGS84 (EPSG:4326)</h3>
        </div>
        <div id="tab4-plot" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        Tile CRS (EPSG:3857 Web Mercator) is reprojected automatically to the plot CRS
        (EPSG:4326 WGS84 lon/lat). Tiles are tessellated into an 8×8 mesh per tile so
        the reprojection is applied per-vertex on the CPU. Scatter points mark 12 major
        cities in geographic coordinates. Zoom and pan to explore.
      </div>
      <div id="tab4-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
}

const plotConfig = {
  layers: [
    {
      tile: {
        source: {
          type: 'xyz',
          url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          subdomains: ['a', 'b', 'c'],
          maxZoom: 19,
        },
        tileCrs: 'EPSG:3857',
        plotCrs: 'EPSG:4326',
        tessellation: 8,
        opacity: 0.9,
      },
    },
    {
      scatter: {
        xData: 'lon',
        yData: 'lat',
        vData: 'cityIdx',
        xAxis: 'xaxis_bottom',
        yAxis: 'yaxis_left',
      },
    },
  ],
  axes: {
    xaxis_bottom: { min: -180, max: 180 },
    yaxis_left:   { min: -80,  max: 80  },
    city_index:   { colorbar: 'vertical', colorscale: 'plasma', min: 0, max: 11 },
  },
}

const plot = new Plot(document.getElementById('tab4-plot'))
plot.update({ config: plotConfig, data })
