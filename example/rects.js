import { Plot } from "../src/index.js"
import { JSONEditor } from '@json-editor/json-editor'
import { } from "./layer-types/RectLayer.js"

// Generate demo data: 1M bars with randomly-spaced x positions. Two tiers of
// large gaps: ~5 "wide bars" (~1/10 of plot width each) and ~3 "holes" (exceed
// the e threshold and render as empty space). Tops and bottoms are gently
// undulating sinusoids with different frequency and phase. Color undulates
// slowly but jumps sharply at a few points.
const n = 1_000_000

// Irregular bar spacing: mostly tight [0.5, 4.5], with two tiers of large gaps:
//   - "wide bars"  (5 positions): spacing 300 000–400 000 → render as wide rects
//   - "hole gaps"  (3 positions): spacing 700 000–1 000 000 → exceed e, become holes
const barX = new Float32Array(n)
const wideSet = new Set([0.12, 0.31, 0.61, 0.78, 0.91].map(f => Math.floor(f * n)))
const holeSet = new Set([0.22, 0.47, 0.85].map(f => Math.floor(f * n)))
for (let i = 1; i < n; i++) {
  barX[i] = barX[i - 1] + (
    holeSet.has(i) ? 700000 + Math.random() * 300000 :
    wideSet.has(i) ? 300000 + Math.random() * 100000 :
    0.5 + Math.random() * 4.0
  )
}

// Top: ~2.5 gentle periods, centered around 4
const barTop    = Float32Array.from({ length: n }, (_, i) => 4 + 1.5 * Math.sin(2 * Math.PI * (i / n) * 2.5))

// Bottom: ~1.7 periods, different phase, always well below tops
const barBottom = Float32Array.from({ length: n }, (_, i) => 0 + 1.2 * Math.sin(2 * Math.PI * (i / n) * 1.7 + 1.1))

// Color: gentle undulation with sharp jumps at three points
const colorBreaks  = [0.22, 0.48, 0.73].map(f => Math.floor(f * n))
const colorOffsets = [0.0, 1.8, -1.4, 0.9]
const barColor = Float32Array.from({ length: n }, (_, i) => {
  let seg = 0
  for (let b = 0; b < colorBreaks.length; b++) if (i >= colorBreaks[b]) seg = b + 1
  return colorOffsets[seg] + 0.3 * Math.sin(2 * Math.PI * (i / n) * 2.8)
})

const data = {
  data: { barX, barTop, barBottom, barColor },
  quantity_kinds: {
    barX: "distance_m",
    barTop: "voltage_V",
    barBottom: "voltage_V",
    barColor: "reflectance_au",
  },
}

{
  const panel = document.createElement('div')
  panel.id = 'tab3'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Rects layer — 1M randomly-spaced bars, undulating tops/bottoms, sharp color jumps</h3>
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
    { rects: { xData: "barX", yTopData: "barTop", yBottomData: "barBottom", vData: "barColor", e: 250000 } }
  ],
  axes: {
    reflectance_au: { colorbar: "vertical", colorscale: "viridis" }
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
