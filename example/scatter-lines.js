import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data } from "./shared.js"

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
}

const plotConfig = {
  layers: [
    { "scatter-sa": { xData: "x2", yData: "y2", vData: "v2", fData: "f2", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } },
    { "multi-line": {
      xData: "time_s",
      filterData: "quality_flag",
      cutoff: 0.5,
      badColor: [0.7, 0.7, 0.7, 1.0],
      xAxis: "xaxis_top",
      yAxis: "yaxis_right",
    } }
  ],
  axes: {
    xaxis_bottom: { min: 0, max: 100 },
    yaxis_right: { min: -2, max: 4 },
    yaxis_left: { min: 10, max: 50 },
    temperature_K: { min: 0, max: 1, colorbar: "vertical" },
    velocity_ms: { min: -2, max: 2, filterbar: "horizontal" }
  }
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
