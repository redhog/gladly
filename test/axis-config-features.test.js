import { assert } from '@esm-bundle/chai'
import { Plot, Axis, linkAxes, registerAxisQuantityKind } from '../src/index.js'
import { LOCK_GLYPH } from '../src/axes/Axis.js'

// ── Quantity kinds with known labels (titles) ────────────────────────────────
const QK_X = 'acf_depth_m'
const QK_Y = 'acf_voltage_v'
const QK_LOG = 'acf_resistivity_log'
const TITLE_X = 'Depth (m)'
const TITLE_Y = 'Voltage (V)'
const QK_Z = 'acf_time_s'
registerAxisQuantityKind(QK_X,   { label: TITLE_X, scale: 'linear' })
registerAxisQuantityKind(QK_Y,   { label: TITLE_Y, scale: 'linear' })
registerAxisQuantityKind(QK_LOG, { label: 'Res',   scale: 'log' })
registerAxisQuantityKind(QK_Z,   { label: 'Time',  scale: 'linear' })

const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }

// Off-screen (left:-9999): the MasterCanvas skips off-screen plots, so no async
// render loop runs to race with synchronous post-update() assertions. This is the
// default for margin / reset / lock / config tests, matching the other suites.
function makeContainer(w = WIDTH, h = HEIGHT) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-9999px;top:0`
  document.body.appendChild(el)
  return el
}

// On-screen (left:0, top:0): render-dependent assertions (atlas marking, lock cues)
// need the plot in the viewport so the MasterCanvas actually draws it.
function makeVisibleContainer(w = WIDTH, h = HEIGHT) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:0;top:0`
  document.body.appendChild(el)
  return el
}

// Construct a plot with its ResizeObserver disconnected. The observer fires a
// forceUpdate() via rAF when the container first gets its size; if that lands while
// the initial update() is still initialising, update() resolves early (epoch bail)
// with axis state (e.g. dataExtent) not yet populated — a race these synchronous
// tests would otherwise hit intermittently. Rendering uses scheduleRender(), not the
// observer, so the cue/atlas tests are unaffected.
function newPlot(container, opts) {
  const p = new Plot(container, opts)
  p.resizeObserver?.disconnect()
  return p
}

function makeData(n = 64, { logY = false } = {}) {
  const x = new Float32Array(n), y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    x[i] = t                        // 0..1
    y[i] = logY ? (1 + 9 * t) : t   // 1..10 (log) or 0..1
  }
  return { input: { x: { data: x, quantity_kind: QK_X }, y: { data: y, quantity_kind: logY ? QK_LOG : QK_Y } } }
}

function baseConfig(axes = {}) {
  return {
    layers: [{ points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left' } }],
    axes,
  }
}

// Resolve after the next completed render pass (cues are recorded during render).
function afterRender(plot) {
  return new Promise(resolve => {
    const cb = () => { plot._renderCallbacks.delete(cb); resolve() }
    plot._renderCallbacks.add(cb)
    plot.scheduleRender()
  })
}

function wheelAt(plot, mx, my, deltaY = 120) {
  const rect = plot._canvas.getBoundingClientRect()
  plot._canvas.dispatchEvent(new WheelEvent('wheel', {
    clientX: rect.left + mx, clientY: rect.top + my, deltaY, bubbles: true, cancelable: true,
  }))
}

function dragFromTo(plot, x0, y0, x1, y1) {
  const rect = plot._canvas.getBoundingClientRect()
  plot._canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + x0, clientY: rect.top + y0, button: 0, bubbles: true, cancelable: true }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + x1, clientY: rect.top + y1, button: 0, bubbles: true }))
  window.dispatchEvent(new MouseEvent('mouseup',   { clientX: rect.left + x1, clientY: rect.top + y1, button: 0, bubbles: true }))
}

function clickAt(plot, mx, my) {
  const rect = plot._canvas.getBoundingClientRect()
  plot._canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + mx, clientY: rect.top + my, button: 0, bubbles: true, cancelable: true }))
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: rect.left + mx, clientY: rect.top + my, button: 0, bubbles: true }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Part 1 — axis-part visibility and margins
// ──────────────────────────────────────────────────────────────────────────────
describe('Axis-part visibility', () => {
  let container, plot
  beforeEach(() => { container = makeVisibleContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('does not mark the title in the atlas when titleVisible is false', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    await afterRender(plot)
    assert.isNull(plot._tickLabelAtlas.getEntry(TITLE_X), 'hidden x title not in atlas')
    assert.isNotNull(plot._tickLabelAtlas.getEntry(TITLE_Y), 'shown y title in atlas')
  })

  it('marks the title when shown and reports drawing it', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    await afterRender(plot)
    assert.isNotNull(plot._tickLabelAtlas.getEntry(TITLE_X))
    assert.isTrue(plot._getAxis('xaxis_bottom')._lastDrewTitle)
  })

  it('does not draw tick labels when tickLabelsVisible is false', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { tickLabelsVisible: false } }) })
    await afterRender(plot)
    assert.isFalse(plot._getAxis('xaxis_bottom')._lastDrewLabels, 'x labels not drawn')
    assert.isTrue(plot._getAxis('yaxis_left')._lastDrewLabels, 'y labels still drawn')
  })
})

describe('Axis-part margins', () => {
  let container, plot
  const FULL = { top: 80, right: 80, bottom: 80, left: 80 }
  const NARROW = { top: 20, right: 20, bottom: 20, left: 20 }
  beforeEach(() => { container = makeContainer(300, 300) })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  async function build(margin, axes) {
    plot = newPlot(container, margin)
    await plot.update({ data: makeData(), config: baseConfig(axes) })
  }

  // Band sizes come from the rendered font (atlas), not constants: a one-line title
  // band is one line height + gap; an x-axis label band is a label height + gap; a
  // y-axis label band is the widest rendered tick-label width + gap.
  const titleBand  = () => plot._tickLabelAtlas.lineHeight + plot._tickLabelAtlas.gap
  const xLabelBand = () => plot._tickLabelAtlas.lineHeight + plot._tickLabelAtlas.gap
  const yLabelBand = () => plot._getAxis('yaxis_left').tickLabelBandPx(plot._tickLabelAtlas)

  it('keeps the full margin when nothing is hidden', async () => {
    await build({ margin: FULL, marginWithoutAxis: NARROW }, {})
    assert.equal(plot.margin.bottom, 80)
    assert.equal(plot.margin.left, 80)
  })

  it('gives back the title band (atlas-sized) when the title is hidden', async () => {
    await build({ margin: FULL, marginWithoutAxis: NARROW },
      { xaxis_bottom: { titleVisible: false }, yaxis_left: { titleVisible: false } })
    assert.isAbove(titleBand(), 0)
    assert.equal(plot.margin.bottom, 80 - titleBand())
    assert.equal(plot.margin.left,   80 - titleBand())
  })

  it('gives back the label band (atlas-sized, wider for y) when tick labels are hidden', async () => {
    await build({ margin: FULL, marginWithoutAxis: NARROW },
      { xaxis_bottom: { tickLabelsVisible: false }, yaxis_left: { tickLabelsVisible: false } })
    assert.equal(plot.margin.bottom, 80 - xLabelBand())
    assert.equal(plot.margin.left,   80 - yLabelBand())
    assert.isAbove(yLabelBand(), xLabelBand(), 'y label band (width) wider than x (height)')
  })

  it('never drops below marginWithoutAxis when both parts are hidden', async () => {
    // Small full margin + larger floor so the reclamation is clamped.
    const SMALL = { top: 40, right: 40, bottom: 40, left: 40 }
    const FLOOR = { top: 30, right: 30, bottom: 30, left: 30 }
    await build({ margin: SMALL, marginWithoutAxis: FLOOR }, {
      xaxis_bottom: { titleVisible: false, tickLabelsVisible: false },
      yaxis_left:   { titleVisible: false, tickLabelsVisible: false },
    })
    // 40 - titleBand - labelBand is negative/below 30 on both sides → floored at 30.
    assert.equal(plot.margin.bottom, 30)
    assert.equal(plot.margin.left, 30)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Part 3 — reset
// ──────────────────────────────────────────────────────────────────────────────
describe('Reset — setDomain(null) / resetAxes', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('setDomain(null) restores the data range of a zoomed axis', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.axes.xaxis_bottom.setDomain(null)
    const d = plot.axes.xaxis_bottom.getDomain()
    assert.closeTo(d[0], 0, 1e-6)
    assert.closeTo(d[1], 1, 1e-6)
  })

  it('propagates the resolved numeric range to a linked axis on another plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const container2 = makeContainer()
    const plot2 = newPlot(container2, { margin: MARGIN })
    await plot2.update({ data: makeData(), config: baseConfig() })
    const link = linkAxes(plot.axes.xaxis_bottom, plot2.axes.xaxis_bottom)
    plot.axes.xaxis_bottom.setDomain([0.3, 0.7])
    plot.axes.xaxis_bottom.setDomain(null)
    const d2 = plot2.axes.xaxis_bottom.getDomain()
    assert.closeTo(d2[0], 0, 1e-6)
    assert.closeTo(d2[1], 1, 1e-6)
    link.unlink(); plot2.destroy(); document.body.removeChild(container2)
  })

  it('resetAxes resets a zoomed axis and keeps a reversed axis reversed', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ yaxis_left: { min: 1, max: 0 } }) })
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.resetAxes()
    const dx = plot.axes.xaxis_bottom.getDomain()
    assert.closeTo(dx[0], 0, 1e-6); assert.closeTo(dx[1], 1, 1e-6)
    const dy = plot.axes.yaxis_left.getDomain()
    assert.isAbove(dy[0], dy[1], 'y stays reversed after reset')
  })

  it('resetAxes refuses zero on a log axis', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(64, { logY: true }), config: baseConfig() })
    plot.axes.yaxis_left.setDomain([2, 8])
    plot.resetAxes()
    const dy = plot.axes.yaxis_left.getDomain()
    assert.isAbove(dy[0], 0, 'log axis min stays above zero')
  })

  it('resetAxes is a no-op on a 3D plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    const n = 32
    const z = new Float32Array(n)
    for (let i = 0; i < n; i++) z[i] = i / (n - 1)
    const data = makeData(n)
    data.input.z = { data: z, quantity_kind: QK_Z }
    await plot.update({
      data,
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y', zData: 'input.z', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left', zAxis: 'zaxis_bottom_left' } }], axes: {} },
    })
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.resetAxes()
    assert.closeTo(plot.axes.xaxis_bottom.getDomain()[0], 0.2, 1e-6)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Part 2 — range lock
// ──────────────────────────────────────────────────────────────────────────────
describe('Range lock — state and enforcement', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  async function build(axes = {}) {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig(axes) })
  }

  it('a wheel in the plot area with x locked moves y only', async () => {
    await build()
    plot.setAxisLocked('xaxis_bottom', true)
    const x0 = plot.axes.xaxis_bottom.getDomain().slice()
    const y0 = plot.axes.yaxis_left.getDomain().slice()
    wheelAt(plot, WIDTH / 2, HEIGHT / 2)
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), x0, 'x locked, unchanged')
    assert.notDeepEqual(plot.axes.yaxis_left.getDomain(), y0, 'y free, moved')
  })

  it('a drag on a locked axis strip does not move it', async () => {
    await build()
    plot.setAxisLocked('xaxis_bottom', true)
    const x0 = plot.axes.xaxis_bottom.getDomain().slice()
    // Bottom axis strip: inside x range, below the plot area.
    dragFromTo(plot, 100, 170, 60, 170)
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), x0)
  })

  it('a programmatic setDomain still moves a locked axis', async () => {
    await build()
    plot.setAxisLocked('xaxis_bottom', true)
    plot.axes.xaxis_bottom.setDomain([0.1, 0.4])
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0.1, 0.4])
  })

  it('resetAxes leaves a locked axis', async () => {
    await build()
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.setAxisLocked('xaxis_bottom', true)
    plot.resetAxes()
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0.2, 0.6])
  })

  it('does not propagate the lock to a linked plot, but the link push still moves the locked axis', async () => {
    await build()
    const container2 = makeContainer()
    const plot2 = newPlot(container2, { margin: MARGIN })
    await plot2.update({ data: makeData(), config: baseConfig() })
    const link = linkAxes(plot.axes.xaxis_bottom, plot2.axes.xaxis_bottom)
    plot.setAxisLocked('xaxis_bottom', true)
    assert.isFalse(plot2.isAxisLocked('xaxis_bottom'), 'lock does not propagate')
    plot2.axes.xaxis_bottom.setDomain([0.25, 0.75])
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0.25, 0.75], 'link push moves locked axis')
    link.unlink(); plot2.destroy(); document.body.removeChild(container2)
  })

  it('turning the lock off clears it; getConfig round-trips locked', async () => {
    await build()
    plot.setAxisLocked('xaxis_bottom', true)
    assert.isTrue(plot.isAxisLocked('xaxis_bottom'))
    assert.isTrue(plot.getConfig().axes.xaxis_bottom.locked)
    plot.setAxisLocked('xaxis_bottom', false)
    assert.isFalse(plot.isAxisLocked('xaxis_bottom'))
    assert.notProperty(plot.getConfig().axes.xaxis_bottom, 'locked')
  })

  it('locking one slot locks every same-QK slot of the same plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({
      data: makeData(),
      config: {
        layers: [
          { points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left' } },
          { points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_top',    yAxis: 'yaxis_left' } },
        ],
        axes: {},
      },
    })
    plot.setAxisLocked('xaxis_bottom', true)
    assert.isTrue(plot.isAxisLocked('xaxis_top'), 'same-QK sibling is locked')
    plot.setAxisLocked('xaxis_bottom', false)
    assert.isFalse(plot.isAxisLocked('xaxis_top'), 'cleared across siblings')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Part 2 — lock cues and title click
// ──────────────────────────────────────────────────────────────────────────────
describe('Lock cues', () => {
  let container, plot
  beforeEach(() => { container = makeVisibleContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('draws the axis line red when locked, and the red line survives hidden parts', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { titleVisible: false, tickLabelsVisible: false } }) })
    plot.setAxisLocked('xaxis_bottom', true)
    await afterRender(plot)
    const c = plot._getAxis('xaxis_bottom')._lastLineColor
    assert.isAbove(c[0], 0.5); assert.isBelow(c[1], 0.5); assert.isBelow(c[2], 0.5)
    assert.isFalse(plot._getAxis('xaxis_bottom')._lastDrewTitle, 'title hidden')
    assert.isFalse(plot._getAxis('xaxis_bottom')._lastDrewLabels, 'labels hidden')
  })

  it('shows the lock glyph with the title drawn and never for a whole-hidden axis', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { locked: true }, yaxis_left: { visible: false, locked: true } }) })
    await afterRender(plot)
    assert.isTrue(plot._getAxis('xaxis_bottom')._lastDrewLockGlyph, 'glyph with title drawn')
    assert.isNotNull(plot._tickLabelAtlas.getEntry(LOCK_GLYPH))
    assert.isFalse(plot._getAxis('yaxis_left')._lastDrewLockGlyph, 'no glyph for hidden axis')
    assert.isNull(plot._getAxis('yaxis_left')._lastLineColor, 'hidden axis draws no line cue')
  })

  it('hides the glyph when the title is hidden, without changing the lock', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { locked: true, titleVisible: false } }) })
    await afterRender(plot)
    assert.isFalse(plot._getAxis('xaxis_bottom')._lastDrewLockGlyph)
    assert.isTrue(plot.isAxisLocked('xaxis_bottom'), 'still locked')
    const c = plot._getAxis('xaxis_bottom')._lastLineColor
    assert.isAbove(c[0], 0.5, 'red line still shows')
  })
})

describe('Title click', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('a click in a 2D axis title band toggles the lock both ways', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    // Bottom title band: below the plot area (y > 140 + tick + label band ≈ 168), x in [60,140].
    clickAt(plot, 100, 180)
    assert.isTrue(plot.isAxisLocked('xaxis_bottom'), 'off → on')
    clickAt(plot, 100, 180)
    assert.isFalse(plot.isAxisLocked('xaxis_bottom'), 'on → off')
  })

  it('a drag starting in the title band pans instead of toggling', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const x0 = plot.axes.xaxis_bottom.getDomain().slice()
    dragFromTo(plot, 100, 180, 60, 180)
    assert.isFalse(plot.isAxisLocked('xaxis_bottom'), 'drag did not toggle')
    assert.notDeepEqual(plot.axes.xaxis_bottom.getDomain(), x0, 'drag panned x')
  })

  it('a click in the title band of a hidden title does nothing', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    clickAt(plot, 100, 180)
    assert.isFalse(plot.isAxisLocked('xaxis_bottom'))
  })

  it('a click on one axis title does not lock another', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    clickAt(plot, 100, 180)  // bottom title
    assert.isTrue(plot.isAxisLocked('xaxis_bottom'))
    assert.isFalse(plot.isAxisLocked('yaxis_left'))
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Config round-trip and per-axis accessors
// ──────────────────────────────────────────────────────────────────────────────
describe('Config round-trip and per-axis accessors', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('getConfig round-trips tickLabelsVisible / titleVisible / locked', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { tickLabelsVisible: false, titleVisible: false, locked: true } }) })
    const c = plot.getConfig().axes.xaxis_bottom
    assert.isFalse(c.tickLabelsVisible)
    assert.isFalse(c.titleVisible)
    assert.isTrue(c.locked)
    // update() restores them
    await plot.update({ config: plot.getConfig() })
    const c2 = plot.getConfig().axes.xaxis_bottom
    assert.isFalse(c2.titleVisible)
    assert.isTrue(c2.locked)
  })

  it('plot.axes[slot].getConfig() deep-equals plot.getConfig().axes[slot]', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    assert.deepEqual(plot.axes.xaxis_bottom.getConfig(), plot.getConfig().axes.xaxis_bottom)
    assert.deepEqual(plot.axes.yaxis_left.getConfig(), plot.getConfig().axes.yaxis_left)
  })

  it('axis.setConfig({min,max}) applies and getConfig() reflects it', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    await plot.axes.xaxis_bottom.setConfig({ min: 0.1, max: 0.9 })
    const c = plot.axes.xaxis_bottom.getConfig()
    assert.closeTo(c.min, 0.1, 1e-6)
    assert.closeTo(c.max, 0.9, 1e-6)
  })

  it('Axis.schema() equals the plot schema axes fragment and validates a slot', async () => {
    const fromPlot = Plot.schema(makeData(), baseConfig()).properties.axes.additionalProperties
    assert.deepEqual(Axis.schema(), fromPlot)
    assert.property(Axis.schema().properties, 'locked')
    assert.property(Axis.schema().properties, 'tickLabelsVisible')
  })
})
