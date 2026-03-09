/**
 * Generate sample data for demonstration using ComputePipeline with
 * GPU-accelerated linspace, random, and glslExpr computations.
 *
 * Exported as a Promise so the module stays synchronous at load time and
 * doesn't poison Parcel's bundle graph with top-level await.
 */

import { ComputePipeline } from "../../src/index.js"
import { resolveExprToColumn } from "../../src/compute/ComputationRegistry.js"

function generate() {
  const pipeline = new ComputePipeline()
  const regl = pipeline.regl

  // Batch readback helpers — separate GPU submission from CPU sync.
  // Phase 1: resolve expression and upload texture (non-blocking).
  function submitColumn(expr) {
    const col = resolveExprToColumn(expr, null, regl, null)
    const tex = col.toTexture(regl)
    const dataLength = tex._dataLength ?? (tex.width * tex.height * 4)
    const fbo = regl.framebuffer({ color: tex, depth: false })
    return { fbo, dataLength }
  }

  // Phase 2: read back one already-submitted column (forces GPU sync on first call).
  function readBack({ fbo, dataLength }) {
    let pixels
    try {
      regl({ framebuffer: fbo })(() => { pixels = regl.read() })
    } finally {
      fbo.destroy()
    }
    const arr = pixels instanceof Float32Array
      ? pixels
      : new Float32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4)
    return arr.slice(0, dataLength)
  }

  // Format a JS number as a GLSL float literal (integers need ".0").
  const f = n => Number.isInteger(n) ? `${n}.0` : `${n}`

  const N = 1_000_000
  const M = 300

  // t_N[i] = (i + 0.5) / N  ≈  i / N  ∈ (0, 1)
  // t_M[i] = (i + 0.5) / M  ≈  i / M  ∈ (0, 1)
  // Pre-resolve once so the GPU texture is created once and shared.
  const t_N = resolveExprToColumn({ linspace: { length: N } }, null, regl, null)
  const t_M = resolveExprToColumn({ linspace: { length: M } }, null, regl, null)

  // Noise: maps random ∈ (0,1) to (-amp/2, +amp/2).
  // Each call uses a distinct seed so each column gets independent noise.
  const noise = (length, seed, amp) => ({
    glslExpr: {
      expr: `({r} - 0.5) * ${f(amp)}`,
      inputs: { r: { random: { length, seed } } }
    }
  })

  // --- Phase 1: submit all GPU compute work (non-blocking) ---

  // Dataset 1: distance (0-10 m) vs voltage (0-5 V)
  // x1[i] = t * 10
  // y1 = 2.5 + 2*sin(x1*0.8) + noise*0.5  →  2.5 + 2*sin(t*8) + n
  // v1 = (sin(x1*2) + 1) / 2               →  (sin(t*20) + 1) / 2
  // f1 = tan(x1)                            →  tan(t*10)
  const s_x1 = submitColumn({ glslExpr: { expr: '{t} * 10.0', inputs: { t: t_N } } })
  const s_y1 = submitColumn({ glslExpr: {
    expr: '2.5 + 2.0 * sin({t} * 8.0) + {n}',
    inputs: { t: t_N, n: noise(N, 1, 0.5) }
  }})
  const s_v1 = submitColumn({ glslExpr: {
    expr: '(sin({t} * 20.0) + 1.0) / 2.0',
    inputs: { t: t_N }
  }})
  const s_f1 = submitColumn({ glslExpr: {
    expr: 'tan({t} * 10.0)',
    inputs: { t: t_N }
  }})

  // Dataset 2: distance (0-100 m) vs current (10-50 A)
  // x2[i] = t * 100
  // y2 = 30 + 15*sin(x2*0.1) + noise*2  →  30 + 15*sin(t*10) + n
  // v2 = (cos(x2*0.15) + 1) / 2         →  (cos(t*15) + 1) / 2
  // f2 = tan(x2*0.1)                    →  tan(t*10)
  const s_x2 = submitColumn({ glslExpr: { expr: '{t} * 100.0', inputs: { t: t_N } } })
  const s_y2 = submitColumn({ glslExpr: {
    expr: '30.0 + 15.0 * sin({t} * 10.0) + {n}',
    inputs: { t: t_N, n: noise(N, 2, 2) }
  }})
  const s_v2 = submitColumn({ glslExpr: {
    expr: '(cos({t} * 15.0) + 1.0) / 2.0',
    inputs: { t: t_N }
  }})
  const s_f2 = submitColumn({ glslExpr: {
    expr: 'tan({t} * 10.0)',
    inputs: { t: t_N }
  }})

  // Time-series: three voltage channels over 10 seconds
  // time_s[i] = t * 10
  // ch1_V = sin(time*2.0) + n    →  sin(t*20) + n
  // ch2_V = cos(time*1.3)*0.7+n  →  cos(t*13)*0.7 + n
  // ch3_V = 0.4*sin(time*3.5+1) + 0.3*cos(time*0.8) + n
  //       →  0.4*sin(t*35+1) + 0.3*cos(t*8) + n
  // quality_flag: time ∈ [3,4] or [7,8]  →  t ∈ [0.3,0.4] or [0.7,0.8]
  const s_time_s = submitColumn({ glslExpr: { expr: '{t} * 10.0', inputs: { t: t_M } } })
  const s_ch1_V = submitColumn({ glslExpr: {
    expr: 'sin({t} * 20.0) + {n}',
    inputs: { t: t_M, n: noise(M, 3, 0.15) }
  }})
  const s_ch2_V = submitColumn({ glslExpr: {
    expr: 'cos({t} * 13.0) * 0.7 + {n}',
    inputs: { t: t_M, n: noise(M, 4, 0.15) }
  }})
  const s_ch3_V = submitColumn({ glslExpr: {
    expr: '0.4 * sin({t} * 35.0 + 1.0) + 0.3 * cos({t} * 8.0) + {n}',
    inputs: { t: t_M, n: noise(M, 5, 0.1) }
  }})
  const s_quality_flag = submitColumn({ glslExpr: {
    expr: '(({t} * 10.0 >= 3.0 && {t} * 10.0 <= 4.0) || ({t} * 10.0 >= 7.0 && {t} * 10.0 <= 8.0)) ? 1.0 : 0.0',
    inputs: { t: t_M }
  }})

  // --- Phase 2: batch readbacks (GPU sync on first call only) ---
  const x1 = readBack(s_x1)
  const y1 = readBack(s_y1)
  const v1 = readBack(s_v1)
  const f1 = readBack(s_f1)
  const x2 = readBack(s_x2)
  const y2 = readBack(s_y2)
  const v2 = readBack(s_v2)
  const f2 = readBack(s_f2)
  const time_s = readBack(s_time_s)
  const ch1_V = readBack(s_ch1_V)
  const ch2_V = readBack(s_ch2_V)
  const ch3_V = readBack(s_ch3_V)
  const quality_flag = readBack(s_quality_flag)

  pipeline.destroy()

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
export const data = Promise.resolve(generate())
