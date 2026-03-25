import { Plot, PlotGroup, registerAxisQuantityKind } from "../src/index.js"
import "../src/layers/PointsLayer.js"
import "../src/layers/BarsLayer.js"
import { data as dataPromise } from "./shared.js"

registerAxisQuantityKind("count", { label: "Count", scale: "linear" })

{
  const panel = document.createElement('div')
  panel.id = 'tab7'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  // 2×2 grid: scatter (large, top-left), y-histogram (top-right), x-histogram (bottom-left)
  panel.style.gridTemplateColumns = '1fr 220px'
  panel.style.gridTemplateRows = '1fr 220px'
  panel.style.padding = '16px'
  panel.style.gap = '10px'
  panel.innerHTML = `
    <div id="tab7-scatter" class="plot-panel" style="width:100%;height:100%;"></div>
    <div id="tab7-yhist"   class="plot-panel" style="width:100%;height:100%;"></div>
    <div id="tab7-xhist"   class="plot-panel" style="width:100%;height:100%;"></div>
    <div></div>
  `
  document.body.appendChild(panel)
}

dataPromise.then(data => {

const scatter = new Plot(document.getElementById('tab7-scatter'))
const xhist   = new Plot(document.getElementById('tab7-xhist'))
const yhist   = new Plot(document.getElementById('tab7-yhist'))
const group = new PlotGroup({ scatter, xhist, yhist }, { autoLink: true })
  
// group.update() must run when the containers have real dimensions so that
// _initialize() completes and _updateAutoLinks() can find axis quantity kinds.
// The panel starts as display:none, so we defer until it is first shown.
const doUpdate = () => group.update({
  data: { input: data },
  plots: {
    scatter: {
      "layers": [
        {
          "points": {
            "xData": "input.v2",
            "yData": "input.y2",
            "vData": "input.x2",
            "xAxis": "xaxis_bottom",
            "yAxis": "yaxis_left"
          }
        }
      ],
      "axes": {
        "xaxis_bottom": { "min": 0,  "max": 1   },
        "yaxis_left":   { "min": 10, "max": 50  },
        "distance_m":   { "min": 0,  "max": 120, "colorbar": "vertical" }
      },
      "colorbars": []
    },
    xhist: {
      "transforms": [
        { "name": "hist", "transform": { "HistogramData": { "input": "input.v2", "filter": "input.y2", "bins": 0 } } }
      ],
      "layers": [
        {
          "bars": {
            "xData": "hist.binCenters",
            "yData": "hist.counts",
            "xAxis": "xaxis_bottom",
            "yAxis": "yaxis_left"
          }
        }
      ],
      "axes": {
        "xaxis_bottom": {},
        "count":        { "label": "Count" }
      },
      "colorbars": []
    },
    yhist: {
      "transforms": [
        { "name": "hist", "transform": { "HistogramData": { "input": "input.y2", "filter": "input.v2", "bins": 0 } } }
      ],
      "layers": [
        {
          "bars": {
            "xData": "hist.binCenters",
            "yData": "hist.counts",
            "orientation": "horizontal",
            "xAxis": "xaxis_bottom",
            "yAxis": "yaxis_left"
          }
        }
      ],
      "axes": {
        "yaxis_left": {},
        "count":      { "label": "Count" }
      },
      "colorbars": []
    }
  }
})

 const panel = document.getElementById('tab7')
if (panel.style.display !== 'none') {
  // Already visible (e.g. user navigated here before data loaded).
  requestAnimationFrame(doUpdate)
} else {
  const obs = new MutationObserver(() => {
    if (panel.style.display !== 'none') {
      obs.disconnect()
      // Wait one frame so the grid layout has resolved and clientWidth > 0.
      requestAnimationFrame(doUpdate)
    }
  })
  obs.observe(panel, { attributes: true, attributeFilter: ['style'] })
}

}) // dataPromise.then
