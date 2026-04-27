import { Plot } from '../src/index.js'
import { JSONEditor } from '@json-editor/json-editor'

// ── Tab setup ─────────────────────────────────────────────────────────────────

{
  const panel = document.createElement('div')
  panel.id = 'tab9'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Terrain (Swiss Alps)</h3>
        </div>
        <div id="tab9-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        3D terrain using AWS Open Terrain elevation tiles (Terrarium encoding) draped
        with OpenStreetMap imagery. Drag to orbit, scroll to zoom.
        <br>DTM tiles: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Open Terrain</a>
        &nbsp;|&nbsp; Imagery: &copy; OpenStreetMap contributors
      </div>
      <div id="tab9-editor-container" class="editor-container"></div>
      <div id="tab9-validation-errors" class="validation-error"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab9-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const _panel_tab9 = document.getElementById('tab9')

// Southern Scandinavia in EPSG:4326 (degrees): Oslo, Gothenburg, Stockholm, Malmö.
// x = longitude (east), z = latitude (north), y = elevation (metres).
const initialConfig = {
  layers: [
    {
      terrain: {
        dtmSource: {
          xyz: {
            url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
            maxZoom: 15,
          },
        },
        dtmTileCrs:  'EPSG:3857',
        satSource: {
          xyz: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            subdomains: ['a', 'b', 'c'],
            maxZoom: 19,
          },
        },
        satTileCrs:  'EPSG:3857',
        plotCrs:     'EPSG:4326',
        tessellation: 16,
        dtmEncoding: 'terrarium',
        opacity:     1.0,
        xAxis:       'xaxis_bottom',
        yAxis:       'yaxis_left',
        zAxis:       'zaxis_bottom_left',
      },
    },
  ],
  axes: {
    xaxis_bottom:      { min: 5.0,  max: 20.0 },
    yaxis_left:        { min: -2000,    max: 6000 },
    zaxis_bottom_left: { min: 61.5, max: 55.0 },
  },
}

const plotData = {}

let currentPlotConfig = initialConfig

const plot = new Plot(document.getElementById('tab9-plot1'))

let lastEditorValue = ''
let lastSchema = ''
let editor

function createEditor(config) {
  lastSchema = JSON.stringify(Plot.schema(plotData, config))
  if (editor) editor.destroy()
  editor = new JSONEditor(document.getElementById('tab9-editor-container'), {
    schema: Plot.schema(plotData, config),
    startval: config,
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
  editor.on('change', async () => {
    const value = editor.getValue()
    if (JSON.stringify(value) === lastEditorValue) return
    lastEditorValue = JSON.stringify(value)
    const errors = editor.validate()
    if (errors.length === 0) {
      const schemaChanged = await updatePlot(value)
      if (schemaChanged) setTimeout(() => createEditor(currentPlotConfig), 0)
    } else {
      const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
      document.getElementById('tab9-validation-errors').innerHTML = `
        <div class="validation-error">
          <strong>Validation Errors:</strong><br>${errorMessages}
        </div>
      `
    }
  })
}

async function updatePlot(plotConfig) {
  try {
    await plot.update({ config: plotConfig, data: plotData })
    document.getElementById('tab9-validation-errors').innerHTML = ''

    const fullConfig = plot.getConfig()
    currentPlotConfig = fullConfig
    const newSchema = JSON.stringify(Plot.schema(plotData, fullConfig))
    if (newSchema !== lastSchema) {
      return true
    } else if (editor) {
      editor.setValue(fullConfig)
      lastEditorValue = JSON.stringify(editor.getValue())
    }

    return false
  } catch (error) {
    console.error('[terrain example]', error)
    document.getElementById('tab9-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

const _doInit_tab9 = async () => {
  await updatePlot(currentPlotConfig)

  const schema = Plot.schema(plotData, currentPlotConfig)
  console.log('[terrain] Plot.schema() result:', schema)
  console.log('[terrain] Plot.schema() JSON size (bytes):', JSON.stringify(schema).length)
  console.log('[terrain] Plot.schema() JSON:', JSON.stringify(schema, null, 2))
  console.log('[terrain] currentPlotConfig:', JSON.stringify(currentPlotConfig, null, 2))

  createEditor(currentPlotConfig)

  plot.onZoomEnd(() => {
    currentPlotConfig = plot.getConfig()
  })
}

if (_panel_tab9.style.display !== 'none') {
  _doInit_tab9()
} else {
  const _obs = new MutationObserver(() => {
    if (_panel_tab9.style.display !== 'none') { _obs.disconnect(); _doInit_tab9() }
  })
  _obs.observe(_panel_tab9, { attributes: true, attributeFilter: ['style'] })
}
