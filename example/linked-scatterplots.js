import { Plot, linkAxes } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise } from "./shared.js"

{
  const panel = document.createElement('div')
  panel.id = 'tab1'
  panel.className = 'tab-content'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Plot 1 (Bottom X-Axis)</h3>
          <button id="tab1-edit-plot1-btn">Edit This Plot</button>
        </div>
        <div id="tab1-plot1" class="plot-panel active"></div>
      </div>
      <div>
        <div class="plot-header">
          <h3>Plot 2 (Top X-Axis - Linked to Plot 1)</h3>
          <button id="tab1-edit-plot2-btn">Edit This Plot</button>
        </div>
        <div id="tab1-plot2" class="plot-panel"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div id="tab1-editor-container" class="editor-container"></div>
      <div id="tab1-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab1-pick-status'
  pickStatus.className = 'pick-status'
  document.body.appendChild(pickStatus)
}

dataPromise.then(data => {

let activePlot = 'plot1'
let editorSyncing = false

const plot1 = new Plot(document.getElementById('tab1-plot1'))
const plot2 = new Plot(document.getElementById('tab1-plot2'))

linkAxes(plot1.axes.xaxis_bottom, plot2.axes.xaxis_top)

let plot1Config = {
  "layers": [
    {
      "scatter": {
        "xData": "x1",
        "yData": "y1",
        "vData": "v1",
        "vData2": "v2",
        "xAxis": "xaxis_bottom",
        "yAxis": "yaxis_left",
        "alphaBlend": false,
        "mode": "points",
        "lineSegmentIdData": "x1",
        "lineColorMode": "gradient",
        "lineWidth": 1
      }
    }
  ],
  "axes": {
    "yaxis_left": {
      "min": 0,
      "max": 5,
      "label": "Voltage (V)",
      "scale": "linear",
    },
    "xaxis_bottom": {
      "min": 0,
      "max": 10,
      "label": "Distance (m)",
      "scale": "linear",
    },
    "temperature_K": {
      "min": 0,
      "max": 1,
      "label": "Temperature (K)",
      "scale": "linear",
      "colorscale": "coolwarm",
      "colorbar": "none"
    },
    "reflectance_au": {
      "min": 0,
      "max": 1,
      "label": "Reflectance (a.u.)",
      "scale": "linear",
      "colorscale": "magma",
      "colorbar": "none"
    },
    "incidence_angle_rad": {
      "min": -1.5,
      "max": 1.5,
      "label": "Incidence angle (rad)",
      "scale": "linear",
      "filterbar": "none"
    }
  },
  "colorbars": [
    {
      "xAxis": "temperature_K",
      "yAxis": "reflectance_au",
      "colorscale": "hsv_phase_magnitude"
    }
  ]
}
    
let plot2Config = {
  "layers": [
    {
      "scatter": {
        "xData": "x1",
        "yData": "y2",
        "vData": "v1",
        "vData2": "none",
        "xAxis": "xaxis_top",
        "yAxis": "yaxis_left",
        "alphaBlend": false,
        "mode": "points",
        "lineSegmentIdData": "x1",
        "lineColorMode": "gradient",
        "lineWidth": 1
      }
    }
  ],
  "axes": {
    "yaxis_left": {
      "min": 14.002025604248047,
      "max": 45.99956512451172,
      "label": "Current (A)",
      "scale": "linear",
      "colorscale": "inferno"
    },
    "xaxis_top": {
      "min": 0,
      "max": 10,
      "label": "Distance (m)",
      "scale": "linear",
      "colorscale": "plasma"
    },
    "reflectance_au": {
      "scale": "linear",
      "colorscale": "coolwarm",
      "colorbar": "horizontal"
    }
  },
  "colorbars": []
}
  
function updatePlot(plotId, plotConfig) {
  const plot = plotId === 'plot1' ? plot1 : plot2
  try {
    plot.update({ config: plotConfig, data })
    document.getElementById('tab1-validation-errors').innerHTML = ''

    const fullConfig = plot.getConfig()
    if (plotId === 'plot1') {
      plot1Config = fullConfig
    } else {
      plot2Config = fullConfig
    }

    return true
  } catch (error) {
    document.getElementById('tab1-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

updatePlot('plot1', plot1Config)
updatePlot('plot2', plot2Config)

function attachPickHandler(plot) {
  plot.on('mouseup', (e) => {
    const rect = plot.container.getBoundingClientRect()
    const result = plot.pick(e.clientX - rect.left, e.clientY - rect.top)
    const status = document.getElementById('tab1-pick-status')
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
}
attachPickHandler(plot1)
attachPickHandler(plot2)

let editor = new JSONEditor(document.getElementById('tab1-editor-container'), {
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
    document.getElementById('tab1-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})

function switchToPlot(plotId) {
  activePlot = plotId

  document.getElementById('tab1-plot1').classList.toggle('active', plotId === 'plot1')
  document.getElementById('tab1-plot2').classList.toggle('active', plotId === 'plot2')

  const newConfig = plotId === 'plot1' ? plot1Config : plot2Config
  editorSyncing = true
  editor.setValue(newConfig)
  editorSyncing = false

  document.getElementById('tab1-validation-errors').innerHTML = ''
}

document.getElementById('tab1-edit-plot1-btn').addEventListener('click', () => {
  switchToPlot('plot1')
})

document.getElementById('tab1-edit-plot2-btn').addEventListener('click', () => {
  switchToPlot('plot2')
})

}) // dataPromise.then
