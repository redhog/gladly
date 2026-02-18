import { Plot, registerLayerType, linkAxes, registerAxisQuantityKind } from "../src/index.js"
import { } from "../src/ScatterLayer.js"
import { } from "../src/FilterbarFloat.js"
import { JSONEditor } from '@json-editor/json-editor'
import { } from "./layer-types/ScatterMVLayer.js"
import { } from "./layer-types/ScatterSALayer.js"
import { data, initialPlot1Config, initialPlot2Config } from "./data/sampleData.js"

registerAxisQuantityKind("voltage_V",            { label: "Voltage (V)",           scale: "linear", colorscale: "viridis"   })
registerAxisQuantityKind("distance_m",           { label: "Distance (m)",          scale: "linear", colorscale: "plasma"    })
registerAxisQuantityKind("current_A",            { label: "Current (A)",           scale: "linear", colorscale: "inferno"   })
registerAxisQuantityKind("reflectance_au",       { label: "Reflectance (a.u.)",    scale: "linear", colorscale: "magma"     })
registerAxisQuantityKind("incidence_angle_rad",  { label: "Incidence angle (rad)", scale: "linear", colorscale: "Spectral"  })
registerAxisQuantityKind("temperature_K",        { label: "Temperature (K)",       scale: "linear", colorscale: "coolwarm"  })
registerAxisQuantityKind("velocity_ms",          { label: "Velocity (m/s)",        scale: "linear", colorscale: "Blues"     })

// Create both plots
const plot1 = new Plot(document.getElementById('plot1'))
const plot2 = new Plot(document.getElementById('plot2'))

// Link the x-axes: plot1's xaxis_bottom to plot2's xaxis_top
const axisLink = linkAxes(plot1, "xaxis_bottom", plot2, "xaxis_top")

// Track which plot is currently being edited
let activePlot = 'plot1'
let plot1Config = initialPlot1Config
let plot2Config = initialPlot2Config
let editorSyncing = false

function updatePlot(plotId, plotConfig) {
  const plot = plotId === 'plot1' ? plot1 : plot2
  try {
    plot.update({ config: plotConfig, data })
    document.getElementById('validation-errors').innerHTML = ''

    // Store the full config (includes live axes/colorscales from getConfig)
    const fullConfig = plot.getConfig()
    if (plotId === 'plot1') {
      plot1Config = fullConfig
    } else {
      plot2Config = fullConfig
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
  editorSyncing = true
  editor.setValue(newConfig)
  editorSyncing = false

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
