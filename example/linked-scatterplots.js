import { Plot, PlotGroup } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { data as dataPromise, showStatus } from "./shared.js"

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

dataPromise.then(async data => {

let activePlot = 'plot1'
let lastEditorValue = ''
let lastSchema = ''
let editor

function createEditor(config) {
  lastSchema = JSON.stringify(Plot.schema({ input: data }, config))
  if (editor) editor.destroy()
  editor = new JSONEditor(document.getElementById('tab1-editor-container'), {
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
      const schemaChanged = await updatePlot(activePlot, value)
      if (schemaChanged) {
        const currentConfig = activePlot === 'plot1' ? plot1Config : plot2Config
        setTimeout(() => createEditor(currentConfig), 0)
      }
    } else {
      const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
      document.getElementById('tab1-validation-errors').innerHTML = `
        <div class="validation-error">
          <strong>Validation Errors:</strong><br>${errorMessages}
        </div>
      `
    }
  })
}

const plot1 = new Plot(document.getElementById('tab1-plot1'))
const plot2 = new Plot(document.getElementById('tab1-plot2'))

const group = new PlotGroup({ plot1, plot2 }, { autoLink: true })

let plot1Config = {
  "layers": [
    {
      "points": {
        "xData": "input.x1",
        "yData": "input.y1",
        "vData": "input.v1",
        "vData2": "input.v2",
        "xAxis": "xaxis_bottom",
        "yAxis": "yaxis_left"
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
      "xAxis": "reflectance_au",
      "yAxis": "temperature_K",
      "colorscale": "bilinear4corner"
    }
  ]
}
    
let plot2Config = {
  "layers": [
    {
      "points": {
        "xData": "input.x1",
        "yData": "input.y2",
        "vData": "input.v1",
        "vData2": "none",
        "xAxis": "xaxis_top",
        "yAxis": "yaxis_left"
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
  
async function updatePlot(plotId, plotConfig) {
  const plot = plotId === 'plot1' ? plot1 : plot2
  try {
    await group.update({ data: { input: data }, plots: { [plotId]: plotConfig } })
    document.getElementById('tab1-validation-errors').innerHTML = ''

    const fullConfig = plot.getConfig()
    if (plotId === 'plot1') {
      plot1Config = fullConfig
    } else {
      plot2Config = fullConfig
    }
    if (plotId === activePlot) {
      const newSchema = JSON.stringify(Plot.schema({ input: data }, fullConfig))
      if (newSchema !== lastSchema) {
        return true
      } else if (editor) {
        editor.setValue(fullConfig)
        lastEditorValue = JSON.stringify(editor.getValue())
      }
    }
    return false
  } catch (error) {
    console.error(error)
    document.getElementById('tab1-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Error:</strong> ${error.message}
      </div>
    `
    return false
  }
}

await group.update({
  data: { input: data },
  plots: { plot1: plot1Config, plot2: plot2Config }
})
plot1Config = plot1.getConfig()
plot2Config = plot2.getConfig()

function attachPickHandler(plot) {
  const status = document.getElementById('tab1-pick-status')
  plot.on('mouseup', async (e) => {
    const rect = plot.container.getBoundingClientRect()
    const result = await plot.pick(e.clientX - rect.left, e.clientY - rect.top)
    if (!result) { showStatus(status, ''); return }
    const { configLayerIndex, dataIndex, layer } = result
    const getRow = (idx) => Object.fromEntries(
      Object.entries(data.data).map(([k, v]) => [k, v[idx]]).filter(([, v]) => v !== undefined)
    )
    if (layer.instanceCount !== null) {
      // Lines: dataIndex is a segment index; source points are at dataIndex and dataIndex+1
      showStatus(status, `layer=${configLayerIndex} segment=${dataIndex} start=${JSON.stringify(getRow(dataIndex))} end=${JSON.stringify(getRow(dataIndex + 1))}`)
    } else {
      showStatus(status, `layer=${configLayerIndex} index=${dataIndex} ${JSON.stringify(getRow(dataIndex))}`)
    }
  })
  plot.on('error', (e) => {
    showStatus(status, e.message, { error: true })
  })
  plot.on('no-error', () => {
    showStatus(status, '')
  })
}
attachPickHandler(plot1)
attachPickHandler(plot2)

createEditor(plot1Config)

function switchToPlot(plotId) {
  activePlot = plotId

  document.getElementById('tab1-plot1').classList.toggle('active', plotId === 'plot1')
  document.getElementById('tab1-plot2').classList.toggle('active', plotId === 'plot2')

  const newConfig = plotId === 'plot1' ? plot1Config : plot2Config
  const newSchema = JSON.stringify(Plot.schema({ input: data }, newConfig))
  if (newSchema !== lastSchema) {
    createEditor(newConfig)
  } else {
    editor.setValue(newConfig)
    lastEditorValue = JSON.stringify(editor.getValue())
  }

  document.getElementById('tab1-validation-errors').innerHTML = ''
}

document.getElementById('tab1-edit-plot1-btn').addEventListener('click', () => {
  switchToPlot('plot1')
})

document.getElementById('tab1-edit-plot2-btn').addEventListener('click', () => {
  switchToPlot('plot2')
})

plot1.onZoomEnd(() => {
  if (activePlot !== 'plot1') return
  plot1Config = plot1.getConfig()
  editor.setValue(plot1Config)
  lastEditorValue = JSON.stringify(editor.getValue())
})

plot2.onZoomEnd(() => {
  if (activePlot !== 'plot2') return
  plot2Config = plot2.getConfig()
  editor.setValue(plot2Config)
  lastEditorValue = JSON.stringify(editor.getValue())
})

}) // dataPromise.then
