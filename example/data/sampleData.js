/**
 * Generate sample data for demonstration
 */

const N = 500

// First sine curve: meters (0-10) vs volts (0-5)
const x1 = new Float32Array(N)
const y1 = new Float32Array(N)
const v1 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 10
  x1[i] = xVal
  y1[i] = 2.5 + 2 * Math.sin(xVal * 0.8) + (Math.random() - 0.5) * 0.5
  v1[i] = (Math.sin(xVal * 2) + 1) / 2
}

// Second sine curve: m/s (0-100) vs ampere (10-50)
const x2 = new Float32Array(N)
const y2 = new Float32Array(N)
const v2 = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const xVal = (i / N) * 100
  x2[i] = xVal
  y2[i] = 30 + 15 * Math.sin(xVal * 0.1) + (Math.random() - 0.5) * 2
  v2[i] = (Math.cos(xVal * 0.15) + 1) / 2
}

// Export data object (shared across all plots)
export const data = { x1, y1, v1, x2, y2, v2 }

// Export initial plot configuration for plot 1
export const initialPlot1Config = {
  layers: [
    { "scatter-mv": { xData: "x1", yData: "y1", vData: "v1", xAxis: "xaxis_bottom", yAxis: "yaxis_left" } }
  ],
  axes: {
    xaxis_bottom: { min: 0, max: 10 },
    yaxis_left: { min: 0, max: 5 }
  }
}

// Export initial plot configuration for plot 2
// NOTE: Plot 2 uses x1 (same as plot 1) so the linked x-axes have compatible units (meters)
export const initialPlot2Config = {
  layers: [
    { "scatter-mv": { xData: "x1", yData: "y2", vData: "v2", xAxis: "xaxis_top", yAxis: "yaxis_right" } }
  ]
  // axes will be auto-calculated from data
}

// Backwards compatibility - keep the old export
export const initialPlotConfig = initialPlot1Config
