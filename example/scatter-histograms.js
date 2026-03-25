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

const scatterConfig = {
  "layers": [
    {
      "points": {
        "xData": "input.x1",
        "yData": "input.y1",
        "xAxis": "xaxis_bottom",
        "yAxis": "yaxis_left"
      }
    }
  ],
  "axes": {
    "xaxis_bottom": { "min": 0, "max": 10, "label": "Distance (m)" },
    "yaxis_left":   { "min": 0, "max": 5,  "label": "Voltage (V)"  }
  },
  "colorbars": []
}

// Histogram of x1 (distance_m), filtered by the y-axis range (voltage_V).
// Shares xaxis_bottom (distance_m) with the scatter via autoLink.
const xHistConfig = {
  "transforms": [
    { "name": "hist", "transform": { "HistogramData": { "input": "input.x1", "filter": "input.y1", "bins": 0 } } }
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
    "xaxis_bottom": { "label": "Distance (m)" },
    "count":        { "label": "Count" }
  },
  "colorbars": []
}

// Histogram of y1 (voltage_V), filtered by the x-axis range (distance_m).
// Shares yaxis_left (voltage_V) with the scatter via autoLink.
// orientation: "horizontal" puts bin centers on y-axis and counts on x-axis.
const yHistConfig = {
  "transforms": [
    { "name": "hist", "transform": { "HistogramData": { "input": "input.y1", "filter": "input.x1", "bins": 0 } } }
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
    "yaxis_left":   { "label": "Voltage (V)" },
    "count":        { "label": "Count" }
  },
  "colorbars": []
}

const scatter = new Plot(document.getElementById('tab7-scatter'))
const xhist   = new Plot(document.getElementById('tab7-xhist'))
const yhist   = new Plot(document.getElementById('tab7-yhist'))

// autoLink wires up all shared quantity kinds automatically:
//   scatter xaxis_bottom (distance_m)  ↔  xhist xaxis_bottom (distance_m)   → shared x scale
//   scatter yaxis_left   (voltage_V)   ↔  yhist yaxis_left   (voltage_V)    → shared y scale
//   scatter yaxis_left   (voltage_V)   ↔  xhist filter axis  (voltage_V)    → x-hist filters on y-zoom
//   scatter xaxis_bottom (distance_m)  ↔  yhist filter axis  (distance_m)   → y-hist filters on x-zoom
const group = new PlotGroup({ scatter, xhist, yhist }, { autoLink: true })

// group.update() must run when the containers have real dimensions so that
// _initialize() completes and _updateAutoLinks() can find axis quantity kinds.
// The panel starts as display:none, so we defer until it is first shown.
const panel = document.getElementById('tab7')
const doUpdate = () => group.update({
  data: { input: data },
  plots: { scatter: scatterConfig, xhist: xHistConfig, yhist: yHistConfig }
})

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
