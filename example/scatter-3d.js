import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise } from "./shared.js"

{
  const panel = document.createElement('div')
  panel.id = 'tab6'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>3D Scatter Plot</h3>
        </div>
        <div id="tab6-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div id="tab6-editor-container" class="editor-container"></div>
      <div id="tab6-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab6-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

dataPromise.then(data => {

const plotConfig = {
  "layers": [
    {
      "points": {
        "xData": "input.x2",
        "yData": "input.y2",
        "zData": "input.v2",
        "zAxis": "zaxis_bottom_left",
        "vData": "input.v2",
        "xAxis": "xaxis_bottom",
        "yAxis": "yaxis_left"
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
    "zaxis_bottom_left": {
      "min": 0,
      "max": 1
    },
    "temperature_K": {
      "min": 0,
      "max": 1,
      "colorbar": "vertical"
    }
  },
  "colorbars": []
}

const plot = new Plot(document.getElementById('tab6-plot1'))
const plotData = { input: data }

let currentPlotConfig = plotConfig
let lastEditorValue = ''
let lastSchema = ''
let editor

function createEditor(config) {
  lastSchema = JSON.stringify(Plot.schema(plotData, config))
  if (editor) editor.destroy()
  editor = new JSONEditor(document.getElementById('tab6-editor-container'), {
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
  editor.on('change', () => {
    const value = editor.getValue()
    if (JSON.stringify(value) === lastEditorValue) return
    lastEditorValue = JSON.stringify(value)
    const errors = editor.validate()
    if (errors.length === 0) {
      const schemaChanged = updatePlot(value)
      if (schemaChanged) setTimeout(() => createEditor(currentPlotConfig), 0)
    } else {
      const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
      document.getElementById('tab6-validation-errors').innerHTML = `
        <div class="validation-error">
          <strong>Validation Errors:</strong><br>${errorMessages}
        </div>
      `
    }
  })
}

function updatePlot(plotConfig) {
  try {
    plot.update({ config: plotConfig })
    document.getElementById('tab6-validation-errors').innerHTML = ''

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
    document.getElementById('tab6-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

plot.update({ config: currentPlotConfig, data: plotData })
updatePlot(currentPlotConfig)

let mousedownPos = null
plot.on('mousedown', (e) => {
  mousedownPos = [e.clientX, e.clientY]
})
plot.on('mouseup', (e) => {
  if (!mousedownPos) return
  const dx = e.clientX - mousedownPos[0]
  const dy = e.clientY - mousedownPos[1]
  mousedownPos = null
  if (dx*dx + dy*dy > 25) return  // drag, not click

  const rect = plot.container.getBoundingClientRect()
  const result = plot.pick(e.clientX - rect.left, e.clientY - rect.top)
  const status = document.getElementById('tab6-pick-status')
  if (!result) { status.textContent = ''; return }
  const { configLayerIndex, dataIndex } = result
  const getRow = (idx) => Object.fromEntries(
    Object.entries(data.data).map(([k, v]) => [k, v[idx]]).filter(([, v]) => v !== undefined)
  )
  status.textContent = `layer=${configLayerIndex} index=${dataIndex} ${JSON.stringify(getRow(dataIndex))}`
})

createEditor(currentPlotConfig)

plot.onZoomEnd(() => {
  const config = plot.getConfig()
  currentPlotConfig = config
  if (editor) {
    editor.setValue(config)
    lastEditorValue = JSON.stringify(editor.getValue())
  }
})

}) // dataPromise.then
