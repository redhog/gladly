import { Plot } from "../src/index.js"
import '../src/layers/GltfLayer.js'

// ── Tab setup ────────────────────────────────────────────────────────────────

{
  const panel = document.createElement('div')
  panel.id = 'tab8'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>GLTF Model (Damaged Helmet)</h3>
        </div>
        <div id="tab8-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        The "Damaged Helmet" glTF 2.0 sample model (CC0, KhronosGroup) loaded via
        <code>GltfLayer</code>. Drag to orbit, scroll to zoom.
      </div>
      <div id="tab8-status" class="validation-error" style="display:none"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab8-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const _panel_tab8 = document.getElementById('tab8')

const DAMAGED_HELMET_URL =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb'

const _doInit_tab8 = async () => {
  const plotConfig = {
    layers: [
      {
        gltf: {
          url: DAMAGED_HELMET_URL,
          xAxis: 'xaxis_bottom',
          yAxis: 'yaxis_left',
          zAxis: 'zaxis_bottom_left',
          lightDir: [0.5, 1.0, 0.5],
          ambientStrength: 0.35,
        }
      }
    ],
    axes: {
      xaxis_bottom:       { min: -1.2, max: 1.2 },
      yaxis_left:         { min: -1.2, max: 1.2 },
      zaxis_bottom_left:  { min: -1.2, max: 1.2 },
    },
  }

  const plot = new Plot(document.getElementById('tab8-plot1'))

  try {
    await plot.update({ config: plotConfig, data: {} })
  } catch (err) {
    console.error(err)
    const s = document.getElementById('tab8-status')
    s.textContent = String(err)
    s.style.display = ''
  }
}

if (_panel_tab8.style.display !== 'none') {
  _doInit_tab8()
} else {
  const _obs = new MutationObserver(() => {
    if (_panel_tab8.style.display !== 'none') { _obs.disconnect(); _doInit_tab8() }
  })
  _obs.observe(_panel_tab8, { attributes: true, attributeFilter: ['style'] })
}
