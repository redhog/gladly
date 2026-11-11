// Gladly performance benchmark — public-API only, so the *same file* runs unmodified
// on both `master` (per-plot WebGL canvases) and `single-context-offscreen` (one shared
// context + per-plot bitmaprenderer canvases). Run each branch from its own git worktree
// on the same machine/browser and copy the JSON output for an A/B comparison.
//
//   bench.html?scene=single&n=100000
//   bench.html?scene=linked&n=1000000&frames=180&sweeps=40
//
// Scenes:
//   single — one scatter Plot, no sharing.
//   linked — two Plots in a PlotGroup with a linked selection ("brush").
// Every plot carries a vertical colorbar Float overlapping the plot body (auto-created
// from the `bench_v` colour axis). That overlap is exactly the case Option B fixes, so
// it must be present — it also adds a second (single) / fourth (linked) display layer.

import { Plot, PlotGroup, registerAxisQuantityKind } from "../src/index.js"

// ─── URL params ────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search)
const SCENE  = params.get('scene') || 'single'
const N      = parseInt(params.get('n')      || '100000', 10)
const FRAMES = parseInt(params.get('frames') || '150', 10)
const SWEEPS = parseInt(params.get('sweeps') || '30', 10)
const DRAWS  = parseInt(params.get('draws')  || '60', 10)

// ─── Quantity kinds (bench-local names, colourscale for the colorbar) ────────────
registerAxisQuantityKind('bench_x', { label: 'X', scale: 'linear' })
registerAxisQuantityKind('bench_y', { label: 'Y', scale: 'linear' })
registerAxisQuantityKind('bench_v', { label: 'V', scale: 'linear', colorscale: 'viridis' })

// ─── Synthetic data ──────────────────────────────────────────────────────────────
function makeData(n) {
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    x[i] = t * 10
    y[i] = Math.sin(t * 40) * 2 + (Math.sin(i * 12.9898) * 43758.5453 % 1)
    v[i] = (Math.sin(t * 20) + 1) / 2
  }
  return {
    data:           { x, y, v },
    quantity_kinds: { x: 'bench_x', y: 'bench_y', v: 'bench_v' },
  }
}

function plotConfig() {
  return {
    layers: [{
      points: {
        xData: 'input.x', yData: 'input.y', vData: 'input.v',
        xAxis: 'xaxis_bottom', yAxis: 'yaxis_left',
        selection: 'brush',
      },
    }],
    axes: {
      xaxis_bottom: { min: 0,  max: 10, label: 'X', scale: 'linear' },
      yaxis_left:   { min: -3, max: 3,  label: 'Y', scale: 'linear' },
      // colorbar:"vertical" auto-creates a colorbar Float that overlaps the plot body.
      bench_v:      { min: 0,  max: 1,  colorscale: 'viridis', colorbar: 'vertical' },
    },
    interactions: { lasso: true },
  }
}

// ─── Stats helpers ───────────────────────────────────────────────────────────────
const nextFrame = () => new Promise(r => requestAnimationFrame(r))

function stats(xs) {
  if (xs.length === 0) return { n: 0 }
  const s = [...xs].sort((a, b) => a - b)
  const pct = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    n: xs.length,
    mean:   +mean.toFixed(3),
    median: +pct(0.5).toFixed(3),
    p95:    +pct(0.95).toFixed(3),
    min:    +s[0].toFixed(3),
    max:    +s[s.length - 1].toFixed(3),
  }
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────────

// Vsync-proof draw throughput: setDomain (marks dirty) + pick() (renders the layers
// and reads 1px back, forcing GPU completion). readPixels is the sync point. This path
// is identical on both branches, isolating GPU draw cost from the display/transfer path.
async function benchDrawLoop(plot, iters) {
  const cx = plot.width / 2, cy = plot.height / 2
  await plot.pick(cx, cy)                                   // warm up
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    const w = 10 * (0.4 + 0.3 * Math.sin(i * 0.3))
    plot.axes['xaxis_bottom'].setDomain([5 - w / 2, 5 + w / 2])
    await plot.pick(cx, cy)
  }
  const wall = performance.now() - t0
  return { msPerFrame: +(wall / iters).toFixed(3), iters, wall: +wall.toFixed(1) }
}

// Real display-path frame time: a scripted zoom ramp driven on rAF. The interval between
// rAFs is the perceived frame time and includes the full display path — offscreen render
// + transferToImageBitmap/transferFromImageBitmap on B, native canvas present on master.
// vsync-capped at ~16.7ms, so this is the cross-check, not the primary metric.
async function benchZoomRamp(plots, frames) {
  const intervals = []
  let prev = null
  for (let i = 0; i < frames; i++) {
    await nextFrame()
    const now = performance.now()
    if (prev !== null) intervals.push(now - prev)
    prev = now
    const w = 10 * (0.4 + 0.3 * Math.sin(i * 0.1))
    const c = 5 + 3 * Math.sin(i * 0.05)
    for (const p of plots) p.axes['xaxis_bottom'].setDomain([c - w / 2, c + w / 2])
  }
  return stats(intervals)
}

// Headline sharing measurement: change the selected set every iteration and time
// end-to-end (selection apply → BOTH plots re-rendered). On master the linked selection
// copies an N-sized mask between per-plot instances (grows with N); on B the instance is
// shared (~0 propagation). pick() on each plot forces its render to complete.
async function benchSelectionSweep(src, all, sweeps) {
  const W = src.width, H = src.height
  const times = []
  for (let i = 0; i < sweeps; i++) {
    const x0 = (i / sweeps) * W * 0.5
    const verts = [
      [x0,           H * 0.2],
      [x0 + W * 0.4, H * 0.2],
      [x0 + W * 0.4, H * 0.8],
      [x0,           H * 0.8],
    ]
    const t0 = performance.now()
    await src.selectLasso(verts)
    for (const p of all) await p.pick(W / 2, H / 2)
    times.push(performance.now() - t0)
  }
  return stats(times)
}

// ─── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  document.body.classList.toggle('single', SCENE === 'single')

  const data = makeData(N)
  const el1  = document.getElementById('panel1')
  const el2  = document.getElementById('panel2')

  const plot1 = new Plot(el1)
  const plots = [plot1]

  let group = null
  if (SCENE === 'linked') {
    const plot2 = new Plot(el2)
    plots.push(plot2)
    group = new PlotGroup({ plot1, plot2 }, { autoLink: true })
    await group.update({ data: { input: data }, plots: { plot1: plotConfig(), plot2: plotConfig() } })
  } else {
    await plot1.update({ data: { input: data }, config: plotConfig() })
  }

  // Let the initial render + colorbar floats settle.
  for (let i = 0; i < 5; i++) await nextFrame()

  const results = {
    scene: SCENE,
    points: N,
    frames: FRAMES,
    sweeps: SWEEPS,
    draws: DRAWS,
    userAgent: navigator.userAgent,
    drawLoop: await benchDrawLoop(plot1, DRAWS),
    zoomRamp: await benchZoomRamp(plots, FRAMES),
  }
  if (SCENE === 'linked') {
    results.selectionSweep = await benchSelectionSweep(plot1, plots, SWEEPS)
  }

  const text = JSON.stringify(results, null, 2)
  document.getElementById('results').textContent = text
  console.log('[gladly-bench]', results)
}

main().catch(e => {
  console.error(e)
  document.getElementById('results').textContent = 'ERROR: ' + (e?.stack || e)
})
