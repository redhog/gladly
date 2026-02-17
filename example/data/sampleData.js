/**
 * Generate sample data for demonstration
 */

const N = 1_000_000

// First sine curve: distance (0-10 m) vs voltage (0-5 V)
// f1 = tan(x1) — used as filter axis to cut out points near tan asymptotes
const x1 = new Float32Array(N)
const y1 = new Float32Array(N)
const v1 = new Float32Array(N)
const f1 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 10
  x1[i] = xVal
  y1[i] = 2.5 + 2 * Math.sin(xVal * 0.8) + (Math.random() - 0.5) * 0.5
  v1[i] = (Math.sin(xVal * 2) + 1) / 2
  f1[i] = Math.tan(xVal)
}

// Second sine curve: distance (0-100 m) vs current (10-50 A)
// f2 = tan(x2 * 0.1) — gentler period so asymptotes stay visible at dataset scale
const x2 = new Float32Array(N)
const y2 = new Float32Array(N)
const v2 = new Float32Array(N)
const f2 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 100
  x2[i] = xVal
  y2[i] = 30 + 15 * Math.sin(xVal * 0.1) + (Math.random() - 0.5) * 2
  v2[i] = (Math.cos(xVal * 0.15) + 1) / 2
  f2[i] = Math.tan(xVal * 0.1)
}

// Export data object (shared across all plots)
export const data = { x1, y1, v1, f1, x2, y2, v2, f2 }

// Export initial plot configuration for plot 1
// f1 filter axis: only show points where -1.5 ≤ tan(x) ≤ 1.5 (hides points near asymptotes)
export const initialPlot1Config = {
  layers: [
    { "scatter-mv": { xData: "x1", yData: "y1", vData: "v1", fData: "f1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } }
  ],
  axes: {
    xaxis_bottom: { min: 0, max: 10 },
    yaxis_left: { min: 0, max: 5 },
    reflectance_au: { min: 0, max: 1, colorbar: "vertical" },
    incidence_angle_rad: { min: -1.5, max: 1.5, filterbar: "horizontal" }
  }
}

// Export initial plot configuration for plot 2 (meters vs ampere, coolwarm colorscale)
// f2 filter axis: only show points where -2 ≤ tan(x*0.1) ≤ 2
export const initialPlot2Config = {
  layers: [
    { "scatter-sa": { xData: "x2", yData: "y2", vData: "v2", fData: "f2", xAxis: "xaxis_top", yAxis: "yaxis_left" } }
  ],
  axes: {
    temperature_K: { min: 0, max: 1, colorbar: "vertical" },
    velocity_ms: { min: -2, max: 2, filterbar: "horizontal" }
  }
}

// Backwards compatibility - keep the old export
export const initialPlotConfig = initialPlot1Config
