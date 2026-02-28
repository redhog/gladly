import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise } from "./shared.js"

{
  const panel = document.createElement('div')
  panel.id = 'tab2'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Plot 1</h3>
        </div>
        <div id="tab2-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div id="tab2-editor-container" class="editor-container"></div>
      <div id="tab2-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab2-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

dataPromise.then(data => {

const plotConfig = {
  "layers": [
    {
      "points": {
        "xData": "x2",
        "yData": "y2",
        "vData": "v2",
        "vData2": "none",
        "fData": "f2",
        "xAxis": "xaxis_bottom",
        "yAxis": "yaxis_left",
        "alphaBlend": false
      }
    },
    {
      "multi-line": {
        "xData": "time_s",
        "filterData": "quality_flag",
        "cutoff": 0.5,
        "badColor": [
          0.7,
          0.7,
          0.7,
          1
        ],
        "xAxis": "xaxis_top",
        "yAxis": "yaxis_right"
      }
    }
  ],
  "axes": {
    "xaxis_bottom": {
      "min": 0,
      "max": 100
    },
    "yaxis_left": {
      "min": 10,
      "max": 50
    },
    "yaxis_right": {
      "min": -2,
      "max": 4
    },
    "temperature_K": {
      "min": 0,
      "max": 1,
      "colorbar": "vertical"
    },
    "velocity_ms": {
      "min": -2,
      "max": 2,
      "filterbar": "horizontal"
    }
  },
  "colorbars": []
}
  
const plot = new Plot(document.getElementById('tab2-plot1'))

let currentPlotConfig = plotConfig
let editorSyncing = false

function updatePlot(plotConfig) {
  try {
    plot.update({ config: plotConfig, data })
    document.getElementById('tab2-validation-errors').innerHTML = ''

    const fullConfig = plot.getConfig()
    currentPlotConfig = fullConfig

    return true
  } catch (error) {
    document.getElementById('tab2-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

updatePlot(currentPlotConfig)

plot.on('mouseup', (e) => {
  const rect = plot.container.getBoundingClientRect()
  const result = plot.pick(e.clientX - rect.left, e.clientY - rect.top)
  const status = document.getElementById('tab2-pick-status')
  if (!result) { status.textContent = ''; return }
  const { configLayerIndex, dataIndex, layer } = result
  const getRow = (idx) => Object.fromEntries(
    Object.entries(data.data).map(([k, v]) => [k, v[idx]]).filter(([, v]) => v !== undefined)
  )
  if (layer.instanceCount !== null) {
    // Lines: dataIndex is a segment index; source points are at dataIndex and dataIndex+1
    status.textContent = `layer=${configLayerIndex} segment=${dataIndex} start=${JSON.stringify(getRow(dataIndex))} end=${JSON.stringify(getRow(dataIndex + 1))}`
  } else {
    status.textContent = `layer=${configLayerIndex} index=${dataIndex} ${JSON.stringify(getRow(dataIndex))}`
  }
})

let editor = new JSONEditor(document.getElementById('tab2-editor-container'), {
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
})

editor.on('change', () => {
  if (editorSyncing) return

  const errors = editor.validate()

  if (errors.length === 0) {
    updatePlot(editor.getValue())
  } else {
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('tab2-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})

}) // dataPromise.then
