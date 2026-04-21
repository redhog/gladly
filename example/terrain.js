import { Plot } from '../src/index.js'
import { JSONEditor } from '@json-editor/json-editor'

// ── Tab setup ─────────────────────────────────────────────────────────────────

{
  const panel = document.createElement('div')
  panel.id = 'tab9'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>Terrain (Swiss Alps)</h3>
        </div>
        <div id="tab9-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        3D terrain using AWS Open Terrain elevation tiles (Terrarium encoding) draped
        with OpenStreetMap imagery. Drag to orbit, scroll to zoom.
        <br>DTM tiles: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Open Terrain</a>
        &nbsp;|&nbsp; Imagery: &copy; OpenStreetMap contributors
      </div>
      <div id="tab9-editor-container" class="editor-container"></div>
      <div id="tab9-validation-errors" class="validation-error"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab9-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const _panel_tab9 = document.getElementById('tab9')

// Swiss Alps region in EPSG:4326 (degrees).
// x = longitude (east), z = latitude (north), y = elevation (metres).
const initialConfig = {
  layers: [
    {
      terrain: {
        dtmSource: {
          xyz: {
            url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
            maxZoom: 15,
          },
        },
        dtmTileCrs:  'EPSG:3857',
        satSource: {
          xyz: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            subdomains: ['a', 'b', 'c'],
            maxZoom: 19,
          },
        },
        satTileCrs:  'EPSG:3857',
        plotCrs:     'EPSG:4326',
        tessellation: 16,
        dtmEncoding: 'terrarium',
        elevScale:   1.0,
        elevOffset:  0.0,
        opacity:     1.0,
        xAxis:       'xaxis_bottom',
        yAxis:       'yaxis_left',
        zAxis:       'zaxis_bottom_left',
      },
    },
  ],
  axes: {
    xaxis_bottom:      { min: 6.0, max: 11.0 },
    yaxis_left:        { min: 0,   max: 4500 },
    zaxis_bottom_left: { min: 45.5, max: 47.5 },
  },
}

const _doInit_tab9 = async () => {
  const plot = new Plot(document.getElementById('tab9-plot1'))

  const schema = Plot.schema()

  const editor = new JSONEditor(document.getElementById('tab9-editor-container'), {
    schema,
    startval: initialConfig,
    theme: 'html',
    iconlib: 'fontawesome4',
    disable_edit_json: false,
    disable_properties: false,
    disable_collapse: false,
    no_additional_properties: false,
    show_errors: 'always',
  })

  const errorsDiv = document.getElementById('tab9-validation-errors')

  async function applyConfig() {
    const errors = editor.validate()
    if (errors.length > 0) {
      errorsDiv.textContent = errors.map(e => e.message).join('\n')
      errorsDiv.style.display = ''
      return
    }
    errorsDiv.style.display = 'none'
    try {
      await plot.update({ config: editor.getValue(), data: {} })
    } catch (err) {
      console.error('[terrain example]', err)
      errorsDiv.textContent = String(err)
      errorsDiv.style.display = ''
    }
  }

  editor.on('change', applyConfig)

  try {
    await plot.update({ config: initialConfig, data: {} })
  } catch (err) {
    console.error('[terrain example]', err)
    const errDiv = document.getElementById('tab9-validation-errors')
    errDiv.textContent = String(err)
    errDiv.style.display = ''
  }
}

if (_panel_tab9.style.display !== 'none') {
  _doInit_tab9()
} else {
  const _obs = new MutationObserver(() => {
    if (_panel_tab9.style.display !== 'none') { _obs.disconnect(); _doInit_tab9() }
  })
  _obs.observe(_panel_tab9, { attributes: true, attributeFilter: ['style'] })
}
