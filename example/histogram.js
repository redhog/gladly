import { Plot, registerAxisQuantityKind } from "../src/index.js"
import "../src/layers/BarsLayer.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise, showStatus } from "./shared.js"

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

dataPromise.then(async data => {

const plotConfig = {
    "transforms": [
        { "name": "hist", "transform": { "HistogramData": { "input": "input.y1", "bins": 0, "filter": "input.f1" } } }
    ],
    "layers": [
        {
            "bars": {
                "xData": "hist.binCenters",
                "yData": "hist.counts",
                "color": [0.2, 0.5, 0.8, 1.0],
                "xAxis": "xaxis_bottom",
                "yAxis": "yaxis_left"
            }
        },
        {
            "lines": {
                "xData": "hist.binCenters",
                "yData": { "kde": { "input": "hist.counts" } },
                "xAxis": "xaxis_bottom",
                "yAxis": "yaxis_left"
            }
        }
    ],
    "axes": {
        "voltage_V": {
            "label": "Voltage (V)"
        },
        "count": {
            "label": "Count"
        },
        "incidence_angle_rad": {
            "filterbar": "horizontal"
        }
    },
    "colorbars": []
};

const plot = new Plot(document.getElementById('tab5-plot1'))

let currentPlotConfig = plotConfig
let lastEditorValue = ''
let lastSchema = ''
let editor

function createEditor(config) {
  lastSchema = JSON.stringify(Plot.schema({ input: data }, config))
  if (editor) editor.destroy()
  editor = new JSONEditor(document.getElementById('tab5-editor-container'), {
    schema: Plot.schema({ input: data }, config),
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
      document.getElementById('tab5-validation-errors').innerHTML = `
        <div class="validation-error">
          <strong>Validation Errors:</strong><br>${errorMessages}
        </div>
      `
    }
  })
}

async function updatePlot(config) {
  try {
    await plot.update({ config, data: { input: data } })
    document.getElementById('tab5-validation-errors').innerHTML = ''
    const fullConfig = plot.getConfig()
    currentPlotConfig = fullConfig
    const newSchema = JSON.stringify(Plot.schema({ input: data }, fullConfig))
    if (newSchema !== lastSchema) {
      return true
    } else if (editor) {
      editor.setValue(fullConfig)
      lastEditorValue = JSON.stringify(editor.getValue())
    }
    return false
  } catch (error) {
    console.error(error)
    document.getElementById('tab5-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

await updatePlot(currentPlotConfig)

plot.on('mouseup', (e) => {
  const rect = plot.container.getBoundingClientRect()
  const result = plot.pick(e.clientX - rect.left, e.clientY - rect.top)
  const status = document.getElementById('tab5-pick-status')
  if (!result) { showStatus(status, ''); return }
  const { configLayerIndex, dataIndex } = result
  showStatus(status, `layer=${configLayerIndex}  bin=${dataIndex}`)
})

plot.on('error', (e) => {
  showStatus(document.getElementById('tab5-pick-status'), e.message, { error: true })
})

createEditor(currentPlotConfig)

plot.onZoomEnd(() => {
  const config = plot.getConfig()
  currentPlotConfig = config
  editor.setValue(config)
  lastEditorValue = JSON.stringify(editor.getValue())
})

}) // dataPromise.then
