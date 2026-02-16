import { Plot, registerLayerType } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { } from "./layer-types/ScatterMVLayer.js"
import { } from "./layer-types/ScatterSALayer.js"
import { data, initialPlotConfig } from "./data/sampleData.js"

let currentPlot = new Plot(document.querySelector('.plot-panel'));

function updatePlot(plotConfig) {
  try {
    currentPlot.update({ config: plotConfig, data })
    document.getElementById('validation-errors').innerHTML = ''
    return true
  } catch (error) {
    document.getElementById('validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

updatePlot(initialPlotConfig)

const editor = new JSONEditor(document.getElementById('editor-container'), {
  schema: Plot.schema(),
  startval: initialPlotConfig,
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

editor.on('change', () => {
  const errors = editor.validate()

  if (errors.length === 0) {
    updatePlot(editor.getValue())
  } else {
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})
