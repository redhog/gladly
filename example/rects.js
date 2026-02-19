import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { } from "./layer-types/RectLayer.js"

// Generate demo data: 1M bars with a bell-curve envelope, wavy tops and bottoms,
// color encoding a sine wave, and a gap at the 25% mark to showcase the e cap.
const n = 1_000_000
const barX      = Float32Array.from({ length: n }, (_, i) => i)
const barTop    = Float32Array.from({ length: n }, (_, i) => {
  const t = (i - n / 2) / (n / 6)
  return 8 * Math.exp(-0.5 * t * t) + 0.5 * Math.sin(i * Math.PI / 200)
})
const barBottom = Float32Array.from({ length: n }, (_, i) => Math.sin(i * Math.PI / 5000) * 1.5)
const barColor  = Float32Array.from({ length: n }, (_, i) => Math.sin(i * Math.PI / 2000))

// Introduce a large gap at the 25% mark to showcase the e cap.
const gappedX = new Float32Array(barX)
const gapStart = Math.floor(n * 0.25)
for (let i = gapStart; i < n; i++) gappedX[i] += 200

const data = { barX: gappedX, barTop, barBottom, barColor }

{
  const panel = document.createElement('div')
  panel.id = 'tab3'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Rects layer — 1M bars via instanced rendering (ANGLE_instanced_arrays)</h3>
        </div>
        <div id="tab3-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div id="tab3-editor-container" class="editor-container"></div>
      <div id="tab3-validation-errors"></div>
    </div>
  `
  document.body.appendChild(panel)
}

const plotConfig = {
  layers: [
    { rects: { xData: "barX", yTopData: "barTop", yBottomData: "barBottom", vData: "barColor", e: 10 } }
  ],
  axes: {
    barColor: { colorbar: "vertical" }
  }
}

const plot = new Plot(document.getElementById('tab3-plot1'))

let currentPlotConfig = plotConfig

function updatePlot(cfg) {
  try {
    plot.update({ config: cfg, data })
    document.getElementById('tab3-validation-errors').innerHTML = ''
    currentPlotConfig = plot.getConfig()
    return true
  } catch (error) {
    document.getElementById('tab3-validation-errors').innerHTML = `
      <div class="validation-error"><strong>Error:</strong> ${error.message}</div>
    `
    return false
  }
}

updatePlot(currentPlotConfig)

const editor = new JSONEditor(document.getElementById('tab3-editor-container'), {
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
  const errors = editor.validate()
  if (errors.length === 0) {
    updatePlot(editor.getValue())
  } else {
    const errorMessages = errors.map(err => `${err.path}: ${err.message}`).join('<br>')
    document.getElementById('tab3-validation-errors').innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong><br>${errorMessages}
      </div>
    `
  }
})
