import { Plot, registerLayerType, linkAxes } from "../src/index.js"
import { } from "../src/ScatterLayer.js"
import { JSONEditor } from '@json-editor/json-editor'
import { } from "./layer-types/ScatterMVLayer.js"
import { } from "./layer-types/ScatterSALayer.js"
import { data, initialPlot1Config, initialPlot2Config } from "./data/sampleData.js"

// Create both plots
const plot1 = new Plot(document.getElementById('plot1'))
const plot2 = new Plot(document.getElementById('plot2'))

// Link the x-axes: plot1's xaxis_bottom to plot2's xaxis_top
const axisLink = linkAxes(plot1, "xaxis_bottom", plot2, "xaxis_bottom")

// Track which plot is currently being edited
let activePlot = 'plot1'
let plot1Config = initialPlot1Config
let plot2Config = initialPlot2Config

function updatePlot(plotId, plotConfig) {
  const plot = plotId === 'plot1' ? plot1 : plot2
  try {
    plot.update({ config: plotConfig, data })
    document.getElementById('validation-errors').innerHTML = ''

    // Update stored config
    if (plotId === 'plot1') {
      plot1Config = plotConfig
    } else {
      plot2Config = plotConfig
    }

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

// Initial updates
updatePlot('plot1', plot1Config)
updatePlot('plot2', plot2Config)

// Initialize editor with plot1's config
let editor = new JSONEditor(document.getElementById('editor-container'), {
  schema: Plot.schema(data),
  startval: plot1Config,
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
    updatePlot(activePlot, editor.getValue())
  } else {
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})

// Function to switch active plot
function switchToPlot(plotId) {
  activePlot = plotId

  // Update UI
  document.getElementById('current-plot-label').textContent = plotId === 'plot1' ? 'Plot 1' : 'Plot 2'
  document.getElementById('plot1').classList.toggle('active', plotId === 'plot1')
  document.getElementById('plot2').classList.toggle('active', plotId === 'plot2')

  // Update editor value without destroying
  const newConfig = plotId === 'plot1' ? plot1Config : plot2Config
  editor.setValue(newConfig)

  // Clear validation errors
  document.getElementById('validation-errors').innerHTML = ''
}

// Add event listeners for plot switching buttons
document.getElementById('edit-plot1-btn').addEventListener('click', () => {
  switchToPlot('plot1')
})

document.getElementById('edit-plot2-btn').addEventListener('click', () => {
  switchToPlot('plot2')
})
