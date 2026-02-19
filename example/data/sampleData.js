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

// Time-series dataset for multi-line demo
// Three voltage channels over 10 seconds; quality_flag marks bad regions
const M = 300
const time_s      = new Float32Array(M)
const ch1_V       = new Float32Array(M)
const ch2_V       = new Float32Array(M)
const ch3_V       = new Float32Array(M)
const quality_flag = new Float32Array(M)
for (let i = 0; i < M; i++) {
  const t = (i / (M - 1)) * 10
  time_s[i]       = t
  ch1_V[i]        = Math.sin(t * 2.0) + 0.15 * (Math.random() - 0.5)
  ch2_V[i]        = Math.cos(t * 1.3) * 0.7 + 0.15 * (Math.random() - 0.5)
  ch3_V[i]        = 0.4 * Math.sin(t * 3.5 + 1) + 0.3 * Math.cos(t * 0.8) + 0.1 * (Math.random() - 0.5)
  quality_flag[i] = (t >= 3 && t <= 4) || (t >= 7 && t <= 8) ? 1.0 : 0.0
}

// Export data object (shared across all plots)
export const data = { x1, y1, v1, f1, x2, y2, v2, f2, time_s, ch1_V, ch2_V, ch3_V, quality_flag }
