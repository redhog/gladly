/**
 * Generate sample data for demonstration using ComputePipeline + ElementwiseData.
 *
 * All columns are generated on the GPU. The pipeline yields to the browser
 * between columns (TDR protection) and reads back once at the end so each
 * Plot can upload into its own WebGL context.
 *
 * Exported as a Promise so the module stays synchronous at load time and
 * doesn't poison Parcel's bundle graph with top-level await.
 */

import { ComputePipeline } from "../../src/index.js"

// Format a JS number as a GLSL float literal (integers need ".0").
const f = n => Number.isInteger(n) ? `${n}.0` : `${n}`

// Noise: maps random ∈ (0,1) to (-amp/2, +amp/2) with a unique seed per column.
const noise = (length, seed, amp) => ({
  glslExpr: {
    expr: `({r} - 0.5) * ${f(amp)}`,
    inputs: { r: { random: { length, seed } } }
  }
})

const N = 1_000_000
const M = 300

// Pre-resolved linspace columns are referenced by both datasets so the GPU
// texture is created once and reused across all downstream glslExpr columns.
const t_N = { linspace: { length: N } }
const t_M = { linspace: { length: M } }

const transforms = [
  {
    name: 'gen',
    transform: {
      ElementwiseData: {
        columns: [
          // Dataset 1: distance (0-10 m) vs voltage (0-5 V)
          { dst: 'x1', quantityKind: 'distance_m',
            src: { glslExpr: { expr: '{t} * 10.0',
                               inputs: { t: t_N } } } },
          { dst: 'y1', quantityKind: 'voltage_V',
            src: { glslExpr: { expr: '2.5 + 2.0 * sin({t} * 8.0) + {n}',
                               inputs: { t: t_N, n: noise(N, 1, 0.5)  } } } },
          { dst: 'v1', quantityKind: 'reflectance_au',
            src: { glslExpr: { expr: '(sin({t} * 20.0) + 1.0) / 2.0',
                               inputs: { t: t_N } } } },
          { dst: 'f1', quantityKind: 'incidence_angle_rad',
            src: { glslExpr: { expr: 'tan({t} * 10.0)',
                               inputs: { t: t_N } } } },
          // Dataset 2: distance (0-100 m) vs current (10-50 A)
          { dst: 'x2', quantityKind: 'distance_m',
            src: { glslExpr: { expr: '{t} * 100.0',
                               inputs: { t: t_N } } } },
          { dst: 'y2', quantityKind: 'current_A',
            src: { glslExpr: { expr: '30.0 + 15.0 * sin({t} * 10.0) + {n}',
                               inputs: { t: t_N, n: noise(N, 2, 2)    } } } },
          { dst: 'v2', quantityKind: 'temperature_K',
            src: { glslExpr: { expr: '(cos({t} * 15.0) + 1.0) / 2.0',
                               inputs: { t: t_N } } } },
          { dst: 'f2', quantityKind: 'velocity_ms',
            src: { glslExpr: { expr: 'tan({t} * 10.0)',
                               inputs: { t: t_N } } } },
          // Time-series: three voltage channels over 10 seconds
          { dst: 'time_s',
            src: { glslExpr: { expr: '{t} * 10.0',
                               inputs: { t: t_M } } } },
          { dst: 'ch1_V', quantityKind: 'voltage_V',
            src: { glslExpr: { expr: 'sin({t} * 20.0) + {n}',
                               inputs: { t: t_M, n: noise(M, 3, 0.15) } } } },
          { dst: 'ch2_V', quantityKind: 'voltage_V',
            src: { glslExpr: { expr: 'cos({t} * 13.0) * 0.7 + {n}',
                               inputs: { t: t_M, n: noise(M, 4, 0.15) } } } },
          { dst: 'ch3_V', quantityKind: 'voltage_V',
            src: { glslExpr: { expr: '0.4 * sin({t} * 35.0 + 1.0) + 0.3 * cos({t} * 8.0) + {n}',
                               inputs: { t: t_M, n: noise(M, 5, 0.1)  } } } },
          { dst: 'quality_flag',
            src: { glslExpr: {
            expr: '(({t}*10.0 >= 3.0 && {t}*10.0 <= 4.0) || ({t}*10.0 >= 7.0 && {t}*10.0 <= 8.0)) ? 1.0 : 0.0',
            inputs: { t: t_M }
          } } },
        ]
      }
    }
  }
]

async function generate() {
  const pipeline = new ComputePipeline()
  const output = await pipeline.update({ transforms })

  // Read all GPU columns back to CPU Float32Arrays.
  // This is necessary because each Plot runs in its own WebGL context
  // and cannot share textures with the pipeline context.
  const data = {}
  const quantity_kinds = {}
  for (const fullCol of output.columns()) {
    const name = fullCol.replace(/^gen\./, '')
    const readable = output.getData(fullCol)
    if (readable) data[name] = readable.getArray()
    if (readable?.quantityKind) quantity_kinds[name] = readable.quantityKind
  }

  pipeline.destroy()
  return { data, quantity_kinds }
}

// generate() is async and returns a Promise — callers await it.
export const data = generate()
