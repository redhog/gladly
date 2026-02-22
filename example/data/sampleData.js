/**
 * Generate sample data for demonstration using @jayce789/numjs for
 * vectorised sin/cos/arithmetic (runs in native/WASM rather than a JS loop).
 *
 * Exported as a Promise so the module stays synchronous at load time and
 * doesn't poison Parcel's bundle graph with top-level await.
 */

import { init, Matrix, sin, cos, add, mul, div } from "@jayce789/numjs"

async function generate() {
  await init({ preferBackend: 'wasm' })

  const N = 1_000_000
  const M = 300

  // Evenly-spaced Float32Array — a single native typed-array allocation, no loop
  function linspace(start, end, n) {
    return Float32Array.from({length: n}, (_, i) => start + (end - start) * (i / n))
  }

  // Random noise Float32Array scaled by amplitude — still JS but only for random values
  function randF32(n, amplitude) {
    return Float32Array.from({length: n}, () => (Math.random() - 0.5) * amplitude)
  }

  // Wrap a Float32Array as a column Matrix
  function m(arr) {
    return new Matrix(arr, arr.length, 1, {dtype: "float32"})
  }

  // Constant-filled Matrix (used as scalar operand)
  function k(value, n) {
    return m(new Float32Array(n).fill(value))
  }

  // Extract Float32Array from a Matrix result.
  // Always .slice() to copy data out of WASM memory — if WASM memory grows between
  // this call and later use of the returned array, the original buffer gets detached.
  function f32(matrix) {
    const arr = matrix.toArray()
    return arr instanceof Float32Array ? arr.slice() : new Float32Array(arr)
  }

  // --- Dataset 1: distance (0-10 m) vs voltage (0-5 V) ---
  // y1 = 2.5 + 2*sin(x1*0.8) + noise*0.5
  // f1 = tan(x1) = sin(x1)/cos(x1)
  const x1 = linspace(0, 10, N)
  const x1m = m(x1)
  const x1_08m = mul(x1m, k(0.8, N))
  const y1 = f32(add(add(k(2.5, N), mul(k(2, N), sin(x1_08m))), m(randF32(N, 0.5))))
  const v1 = f32(div(add(sin(mul(x1m, k(2, N))), k(1, N)), k(2, N)))
  const f1 = f32(div(sin(x1m), cos(x1m)))

  // --- Dataset 2: distance (0-100 m) vs current (10-50 A) ---
  // y2 = 30 + 15*sin(x2*0.1) + noise*2
  // f2 = tan(x2*0.1) = sin(x2*0.1)/cos(x2*0.1)
  const x2 = linspace(0, 100, N)
  const x2m = m(x2)
  const x2_01m = mul(x2m, k(0.1, N))
  const y2 = f32(add(add(k(30, N), mul(k(15, N), sin(x2_01m))), m(randF32(N, 2))))
  const v2 = f32(div(add(cos(mul(x2m, k(0.15, N))), k(1, N)), k(2, N)))
  const f2 = f32(div(sin(x2_01m), cos(x2_01m)))

  // --- Time-series: three voltage channels over 10 seconds ---
  // Three channels with independent sine/cosine signals plus noise
  const time_s = Float32Array.from({length: M}, (_, i) => (i / (M - 1)) * 10)
  const tm = m(time_s)
  const ch1_V = f32(add(sin(mul(tm, k(2.0, M))), m(randF32(M, 0.15))))
  const ch2_V = f32(add(mul(cos(mul(tm, k(1.3, M))), k(0.7, M)), m(randF32(M, 0.15))))
  const ch3_V = f32(add(
    add(
      mul(k(0.4, M), sin(add(mul(tm, k(3.5, M)), k(1, M)))),
      mul(k(0.3, M), cos(mul(tm, k(0.8, M))))
    ),
    m(randF32(M, 0.1))
  ))
  const quality_flag = Float32Array.from(time_s, t => (t >= 3 && t <= 4) || (t >= 7 && t <= 8) ? 1.0 : 0.0)

  return {
    data: { x1, y1, v1, f1, x2, y2, v2, f2, time_s, ch1_V, ch2_V, ch3_V, quality_flag },
    quantity_kinds: {
      x1: "distance_m",
      y1: "voltage_V",
      v1: "reflectance_au",
      f1: "incidence_angle_rad",
      x2: "distance_m",
      y2: "current_A",
      v2: "temperature_K",
      f2: "velocity_ms",
      ch1_V: "voltage_V",
      ch2_V: "voltage_V",
      ch3_V: "voltage_V",
    },
  }
}

// Export as a Promise — callers await it; no top-level await here.
export const data = generate()
