import { Plot, registerAxisQuantityKind } from '../src/index.js'
import { JSONEditor } from '@json-editor/json-editor'

registerAxisQuantityKind('pop_density', {
  label: 'Population density',
  scale: 'linear',
  colorscale: 'hot',
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

// Per-city [peakDensity, sigmaLon, sigmaLat] — varied to look plausible
const cityParams = [
  [1.00, 1.4, 1.1],  // New York      — large, dense metro
  [0.90, 0.8, 0.8],  // London        — compact city
  [1.00, 1.1, 0.9],  // Tokyo         — extremely dense
  [0.60, 1.2, 0.9],  // Sydney        — coastal sprawl
  [0.85, 0.7, 0.7],  // Paris         — compact, high density core
  [0.65, 1.3, 1.0],  // Rio de Janeiro — coastal, elongated
  [0.50, 1.1, 0.9],  // Johannesburg  — spread out
  [0.95, 1.0, 0.9],  // Shanghai      — vast dense metro
  [0.80, 1.4, 1.1],  // Chicago       — large lakefront metro
  [0.75, 1.2, 1.0],  // Moscow        — large, radial
  [1.00, 1.0, 0.8],  // New Delhi     — very dense
  [0.55, 0.9, 0.7],  // Cape Town     — smaller city
]

// Build ~1M points: 289×289 grid per city × 12 cities = 1,002,252 points
const gridN    = 289
const spreadLon = 3.0  // ±3° lon per city
const spreadLat = 3.0  // ±3° lat per city

const lonArr  = []
const latArr  = []
const densArr = []

cityCoords.forEach(([cLon, cLat], ci) => {
  const [peak, sigLon, sigLat] = cityParams[ci]
  for (let gy = 0; gy < gridN; gy++) {
    const dLat = (gy / (gridN - 1) - 0.5) * 2 * spreadLat
    for (let gx = 0; gx < gridN; gx++) {
      const dLon = (gx / (gridN - 1) - 0.5) * 2 * spreadLon
      const dens = peak * Math.exp(
        -(dLon * dLon) / (2 * sigLon * sigLon)
        -(dLat * dLat) / (2 * sigLat * sigLat)
      ) + 0.015 * Math.random()
      lonArr.push(cLon + dLon)
      latArr.push(cLat + dLat)
      densArr.push(Math.max(0, dens))
    }
  }
})

const lon     = new Float32Array(lonArr)
const lat     = new Float32Array(latArr)
const popDens = new Float32Array(densArr)

// Data uses EPSG:4326 quantity kinds so it shares axes with the tile layer
const data = {
  data: { lon, lat, popDens },
  quantity_kinds: {
    lon:     'epsg_4326_x',
    lat:     'epsg_4326_y',
    popDens: 'pop_density',
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
      <div id="tab4-editor-container" class="editor-container"></div>
      <div id="tab4-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab4-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const plotConfig = {
  layers: [
    {
      tile: {
        source: {
          xyz: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            subdomains: ['a', 'b', 'c'],
            maxZoom: 19,
          },
        },
        tileCrs: 'EPSG:3857',
        plotCrs: 'EPSG:4326',
        tessellation: 8,
        opacity: 0.9,
      },
    },
    {
      points: {
        xData: 'lon',
        yData: 'lat',
        vData: 'popDens',
        xAxis: 'xaxis_bottom',
        yAxis: 'yaxis_left',
      },
    },
  ],
  axes: {
    xaxis_bottom: { min: -180, max: 180 },
    yaxis_left:   { min: -80,  max: 80  },
    pop_density:  { colorbar: 'vertical', colorscale: 'hot', min: 0, max: 1, alpha_blend: 1.0 },
  },
}

const plot = new Plot(document.getElementById('tab4-plot'))

let currentPlotConfig = plotConfig
let lastEditorValue = ''
let editor

function updatePlot(plotConfig) {
  try {
    plot.update({ config: plotConfig, data })
    document.getElementById('tab4-validation-errors').innerHTML = ''

    const fullConfig = plot.getConfig()
    currentPlotConfig = fullConfig
    if (editor) {
      editor.setValue(fullConfig)
      lastEditorValue = JSON.stringify(editor.getValue())
    }

    return true
  } catch (error) {
    document.getElementById('tab4-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

updatePlot(currentPlotConfig)

editor = new JSONEditor(document.getElementById('tab4-editor-container'), {
  schema: Plot.schema(data),
  startval: currentPlotConfig,
  theme: 'html',
  iconlib: 'fontawesome4',
  disable_collapse: false,
  disable_edit_json: false,
  disable_properties: false,
  no_additional_properties: false,
  required_by_default: false,
  show_errors: 'always',
  compact: false
})

editor.on('ready', () => {
  const rootEditor = editor.editors['root']
  if (rootEditor && rootEditor.editjson_control) {
    rootEditor.editjson_control.classList.add('je-root-editjson')
  }
  lastEditorValue = JSON.stringify(editor.getValue())
})

editor.on('change', () => {
  const value = editor.getValue()
  if (JSON.stringify(value) === lastEditorValue) return
  lastEditorValue = JSON.stringify(value)

  const errors = editor.validate()

  if (errors.length === 0) {
    updatePlot(value)
  } else {
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('tab4-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})

plot.onZoomEnd(() => {
  const config = plot.getConfig()
  currentPlotConfig = config
  editor.setValue(config)
  lastEditorValue = JSON.stringify(editor.getValue())
})
