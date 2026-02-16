import { Plot, registerLayerType } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { ScatterMVLayer } from "./layer-types/ScatterMVLayer.js"
import { ScatterSALayer } from "./layer-types/ScatterSALayer.js"
import { data, initialPlotConfig } from "./data/sampleData.js"

// Register layer types
registerLayerType("scatter-mv", ScatterMVLayer)
registerLayerType("scatter-sa", ScatterSALayer)

const container = document.querySelector('.plot-panel')

// Current plot instance
let currentPlot = null

// Function to create/recreate the plot
function createPlot(plotConfig) {
  const config = {
    width: 800,
    height: 600,
    data,
    plot: plotConfig
  }

  try {
    if (currentPlot) {
      // Update existing plot
      currentPlot.update(config)
    } else {
      // Create new plot
      currentPlot = new Plot({
        container,
        ...config
      })
    }

    // Clear any validation errors
    document.getElementById('validation-errors').innerHTML = ''
    return true
  } catch (error) {
    // Show error
    document.getElementById('validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

// Create initial plot
createPlot(initialPlotConfig)

// Get the schema from Plot
const plotSchema = Plot.schema()

// Initialize JSON editor with the schema
const editor = new JSONEditor(document.getElementById('editor-container'), {
  schema: plotSchema,
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

// Listen for changes
editor.on('change', () => {
  const errors = editor.validate()

  if (errors.length === 0) {
    // Valid configuration - update the plot
    const plotConfig = editor.getValue()
    createPlot(plotConfig)
  } else {
    // Show validation errors
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})

// Log the schema for demonstration
console.log("Plot schema:", JSON.stringify(plotSchema, null, 2))
