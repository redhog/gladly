import { Plot, registerAxisQuantityKind } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise } from "./shared.js"

// Register the count axis so the y-axis gets a sensible label.
registerAxisQuantityKind("count", { label: "Count", scale: "linear" })

{
  const panel = document.createElement('div')
  panel.id = 'tab5'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Histogram</h3>
        </div>
        <div id="tab5-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        Histogram of 1 M voltage samples. Each bar's height is computed on
        the GPU via the <code>histogram</code> texture computation.
        Click a bar to see its bin index.
      </div>
      <div id="tab5-editor-container" class="editor-container"></div>
      <div id="tab5-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)

  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab5-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

dataPromise.then(data => {

const plotConfig = {
    "layers": [
        {
            "histogram": {
                "vData": "y1",
                "filterColumn": "v1",
                "bins": 0,
                "color": [
                    0.2,
                    0.5,
                    0.8,
                    1
                ],
                "xAxis": "xaxis_bottom",
                "yAxis": "yaxis_left"
            }
        }
    ],
    "axes": {
        "voltage_V": {
            "label": "Voltage (V)"
        },
        "reflectance_au": {
          "filterbar": "horizontal",
          "min": -0.5,
          "max": 0.5
        },
        "count": {
            "label": "Count"
        }
    },
    "colorbars": []
};

const plot = new Plot(document.getElementById('tab5-plot1'))

let currentPlotConfig = plotConfig
let lastEditorValue = ''
let editor

function updatePlot(config) {
  try {
    plot.update({ config, data })
    document.getElementById('tab5-validation-errors').innerHTML = ''
    const fullConfig = plot.getConfig()
    currentPlotConfig = fullConfig
    if (editor) {
      editor.setValue(fullConfig)
      lastEditorValue = JSON.stringify(editor.getValue())
    }
    return true
  } catch (error) {
    document.getElementById('tab5-validation-errors').innerHTML = `
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
  const status = document.getElementById('tab5-pick-status')
  if (!result) { status.textContent = ''; return }
  const { configLayerIndex, dataIndex } = result
  status.textContent = `layer=${configLayerIndex}  bin=${dataIndex}`
})

editor = new JSONEditor(document.getElementById('tab5-editor-container'), {
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
    document.getElementById('tab5-validation-errors').innerHTML = `
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

}) // dataPromise.then
