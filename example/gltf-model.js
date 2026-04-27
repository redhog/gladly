import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import '../src/layers/GltfLayer.js'

// ── Tab setup ────────────────────────────────────────────────────────────────

{
  const panel = document.createElement('div')
  panel.id = 'tab8'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>GLTF Model (Damaged Helmet)</h3>
        </div>
        <div id="tab8-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div id="tab8-editor-container" class="editor-container"></div>
      <div id="tab8-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab8-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const _panel_tab8 = document.getElementById('tab8')

const DAMAGED_HELMET_URL =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb'

const plotData = {}

let currentPlotConfig = {
  layers: [
    {
      gltf: {
        url: DAMAGED_HELMET_URL,
        xAxis: 'xaxis_bottom',
        yAxis: 'yaxis_left',
        zAxis: 'zaxis_bottom_left',
        lightDir: [0.5, 1.0, 0.5],
        ambientStrength: 0.35,
      }
    }
  ],
  axes: {
    xaxis_bottom:       { min: -1.2, max: 1.2 },
    yaxis_left:         { min: -1.2, max: 1.2 },
    zaxis_bottom_left:  { min: -1.2, max: 1.2 },
  },
}

const plot = new Plot(document.getElementById('tab8-plot1'))

let lastEditorValue = ''
let lastSchema = ''
let editor

function createEditor(config) {
  lastSchema = JSON.stringify(Plot.schema(plotData, config))
  if (editor) editor.destroy()
  editor = new JSONEditor(document.getElementById('tab8-editor-container'), {
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
      document.getElementById('tab8-validation-errors').innerHTML = `
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
    document.getElementById('tab8-validation-errors').innerHTML = ''

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
    console.error(error)
    document.getElementById('tab8-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

const _doInit_tab8 = async () => {
  await updatePlot(currentPlotConfig)

  const schema = Plot.schema(plotData, currentPlotConfig)
  console.log('[gltf] Plot.schema() result:', schema)
  console.log('[gltf] Plot.schema() JSON size (bytes):', JSON.stringify(schema).length)
  console.log('[gltf] Plot.schema() JSON:', JSON.stringify(schema, null, 2))
  console.log('[gltf] currentPlotConfig:', JSON.stringify(currentPlotConfig, null, 2))

  createEditor(currentPlotConfig)

  plot.onZoomEnd(() => {
    currentPlotConfig = plot.getConfig()
  })
}

if (_panel_tab8.style.display !== 'none') {
  _doInit_tab8()
} else {
  const _obs = new MutationObserver(() => {
    if (_panel_tab8.style.display !== 'none') { _obs.disconnect(); _doInit_tab8() }
  })
  _obs.observe(_panel_tab8, { attributes: true, attributeFilter: ['style'] })
}
