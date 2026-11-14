import { assert } from '@esm-bundle/chai'
import { Plot, linkAxes, registerAxisQuantityKind } from '../src/index.js'

// ── Quantity kinds with known titles ─────────────────────────────────────────
const QK_X = 'acm_depth_m'
const QK_Y = 'acm_voltage_v'
const QK_Z = 'acm_time_s'
registerAxisQuantityKind(QK_X, { label: 'Depth (m)',   scale: 'linear' })
registerAxisQuantityKind(QK_Y, { label: 'Voltage (V)', scale: 'linear' })
registerAxisQuantityKind(QK_Z, { label: 'Time (s)',    scale: 'linear' })
// Colour (×2 for a 2D pair) and filter quantity kinds for the extra-table tests.
const QK_C = 'acm_refl', QK_C2 = 'acm_temp', QK_F = 'acm_gate'
const PAIR = `${QK_C}__${QK_C2}`
registerAxisQuantityKind(QK_C,  { label: 'Refl',   scale: 'linear', colorscale: 'magma' })
registerAxisQuantityKind(QK_C2, { label: 'Temp',   scale: 'linear', colorscale: 'coolwarm' })
registerAxisQuantityKind(QK_F,  { label: 'Gate',   scale: 'linear' })
const TWOD = 'bilinear4corner'   // pre-registered 2D colorscale

const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }
// 2D region reference points (plotWidth/Height = 80, so the plot box is x,y in [60,140]).
const PLOT_AREA   = [100, 100]
const BOTTOM_STRIP = [100, 160]
const LEFT_STRIP   = [30, 100]
const CORNER       = [20, 20]

function makeContainer(w = WIDTH, h = HEIGHT) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-9999px;top:0`
  document.body.appendChild(el)
  return el
}

// Rendering plays no part in these tests (menu DOM and the event both exist off-screen),
// but the ResizeObserver is disconnected for the same reason as the sibling suite: its
// rAF forceUpdate() could otherwise race the synchronous post-update() assertions.
function newPlot(container, opts) {
  const p = new Plot(container, opts)
  p.resizeObserver?.disconnect()
  return p
}

function makeData(n = 32) {
  const x = new Float32Array(n), y = new Float32Array(n)
  for (let i = 0; i < n; i++) { const t = i / (n - 1); x[i] = t; y[i] = t }
  return { input: { x: { data: x, quantity_kind: QK_X }, y: { data: y, quantity_kind: QK_Y } } }
}

function make3DData(n = 32) {
  const data = makeData(n)
  const z = new Float32Array(n)
  for (let i = 0; i < n; i++) z[i] = i / (n - 1)
  data.input.z = { data: z, quantity_kind: QK_Z }
  return data
}

function baseConfig(axes = {}, extra = {}) {
  return { layers: [{ points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left' } }], axes, ...extra }
}

function config3D(axes = {}, extra = {}) {
  return { layers: [{ points: { xData: 'input.x', yData: 'input.y', zData: 'input.z', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left', zAxis: 'zaxis_bottom_left' } }], axes, ...extra }
}

// A points layer with vData (+ vData2 → a 2D pair) and fData → two colour axes, one 2D
// pairing and one filter axis, so the full menu's extra table has all three row kinds.
function makeColorData(n = 32) {
  const data = makeData(n)
  const c = new Float32Array(n), c2 = new Float32Array(n), f = new Float32Array(n)
  for (let i = 0; i < n; i++) { const t = i / (n - 1); c[i] = t; c2[i] = 1 - t; f[i] = t }
  data.input.c  = { data: c,  quantity_kind: QK_C }
  data.input.c2 = { data: c2, quantity_kind: QK_C2 }
  data.input.f  = { data: f,  quantity_kind: QK_F }
  return data
}
function colorConfig(colorbars = []) {
  return {
    layers: [{ points: { xData: 'input.x', yData: 'input.y', vData: 'input.c', vData2: 'input.c2', fData: 'input.f', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left' } }],
    axes: {}, colorbars,
  }
}
const extraRow = (sel) => document.querySelector(`[data-gladly-control="axis-menu"] tr[${sel}]`)
const ctrl = (sel) => document.querySelector(`[data-gladly-control="axis-menu"] [${sel}]`)

// ── Event dispatch helpers (mousedown on the canvas, mouseup on window) ───────
function down(plot, mx, my, button) {
  const rect = plot._canvas.getBoundingClientRect()
  plot._canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + mx, clientY: rect.top + my, button, bubbles: true, cancelable: true }))
}
function move(plot, mx, my, button = 0) {
  const rect = plot._canvas.getBoundingClientRect()
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + mx, clientY: rect.top + my, button, bubbles: true }))
}
function up(plot, mx, my, button) {
  const rect = plot._canvas.getBoundingClientRect()
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: rect.left + mx, clientY: rect.top + my, button, bubbles: true }))
}
function rightPressAt(plot, [mx, my]) { down(plot, mx, my, 2); up(plot, mx, my, 2) }
function rightDrag(plot, [x0, y0], [x1, y1]) { down(plot, x0, y0, 2); move(plot, x1, y1, 2); up(plot, x1, y1, 2) }

function captureContextMenu(plot) {
  const events = []
  plot.on('contextmenu', (e, coords, region) => events.push({ e, coords, region }))
  return events
}

// Point the 3D camera at an orientation that projects axis strips onto a 200px canvas.
// (The default orientation leaves no strip reachable at this small size — a property of
// _getRegion3D's projection, unrelated to the menu.) Set after update(), which rebuilds
// the camera.
function orient3D(plot) { plot._camera._theta = -0.7; plot._camera._phi = 0.4 }

// A canvas pixel that _getRegion resolves to an axis strip — the strip pixels of a 3D
// plot depend on the camera projection, so probe for one rather than hard-coding it.
function findStrip(plot) {
  const zc = plot._zoomController
  for (let my = 2; my < HEIGHT; my += 3)
    for (let mx = 2; mx < WIDTH; mx += 3)
      if (zc._getRegion(mx, my)?.type === 'axis') return [mx, my]
  return null
}

// The menu is attached to document.body (so it escapes any float's clip / stacking).
function menuEl(plot) { return document.querySelector('[data-gladly-control="axis-menu"]') }
function rowNames(el) { return [...el.querySelectorAll('tr')].slice(1).map(tr => tr.querySelector('td').textContent) }
function boxOf(el, slot, key) { return el.querySelector(`input[data-axis="${slot}"][data-key="${key}"]`) }

// ──────────────────────────────────────────────────────────────────────────────
// Part 1 — the 'contextmenu' event
// ──────────────────────────────────────────────────────────────────────────────
describe("The 'contextmenu' event", () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('fires once on a right press+release, with coordinates', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const events = captureContextMenu(plot)
    rightPressAt(plot, PLOT_AREA)
    assert.equal(events.length, 1, 'fired once')
    assert.isNumber(events[0].coords.xaxis_bottom, 'carries coords')
    assert.isNumber(events[0].coords.yaxis_left)
  })

  it('does not fire for a right press that closed a polygon', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({}, { interactions: { lasso: [{ selection: 'sel', mode: 'polygon' }] } }) })
    const events = captureContextMenu(plot)
    // Place two polygon corners (shift = the default trigger), then right-click to close.
    const rect = plot._canvas.getBoundingClientRect()
    for (const [mx, my] of [[80, 80], [120, 80]]) {
      plot._canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + mx, clientY: rect.top + my, button: 0, shiftKey: true, bubbles: true, cancelable: true }))
      up(plot, mx, my, 0)
    }
    rightPressAt(plot, [120, 120])
    assert.equal(events.length, 0, 'the polygon-closing right press emits nothing')
  })

  it('fires once on a non-rotating 3D right press, but not on a 3D right drag', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: make3DData(), config: config3D() })
    assert.isTrue(plot._is3D)
    const events = captureContextMenu(plot)
    rightDrag(plot, [100, 100], [60, 70])   // a rotation
    assert.equal(events.length, 0, 'a right drag (rotation) emits nothing')
    rightPressAt(plot, PLOT_AREA)            // a still press
    assert.equal(events.length, 1, 'a still right press emits once')
  })

  it('names the axis strip in 2D, and none for the plot area or a corner', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const events = captureContextMenu(plot)
    rightPressAt(plot, BOTTOM_STRIP)
    assert.equal(events[0].region.type, 'axis')
    assert.deepEqual(events[0].region.axes, ['xaxis_bottom'])
    rightPressAt(plot, PLOT_AREA)
    assert.equal(events[1].region.type, 'plot_area')
    rightPressAt(plot, CORNER)
    assert.isNull(events[2].region, 'a corner is in no region')
  })

  it('names an axis strip on a 3D plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: make3DData(), config: config3D() })
    orient3D(plot)
    const events = captureContextMenu(plot)
    const strip = findStrip(plot)
    assert.isOk(strip, 'a 3D axis strip pixel exists')
    rightPressAt(plot, strip)
    assert.equal(events[0].region?.type, 'axis')
    assert.equal(events[0].region.axes.length, 1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Part 2 — the 'axisoptions' event
// ──────────────────────────────────────────────────────────────────────────────
describe("The 'axisoptions' event", () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  function captureAxisOptions(plot) {
    const events = []
    plot.on('axisoptions', (e) => events.push(e))
    return events
  }

  it('fires once with { axis, key, value } when a visibility key changes via update()', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const events = captureAxisOptions(plot)
    await plot.update({ config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    assert.deepEqual(events, [{ type: 'axisoptions', axis: 'xaxis_bottom', key: 'titleVisible', value: false }])
  })

  it('fires once for a direct setAxisLocked() with no menu', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const events = captureAxisOptions(plot)
    plot.setAxisLocked('xaxis_bottom', true)
    assert.deepEqual(events, [{ type: 'axisoptions', axis: 'xaxis_bottom', key: 'locked', value: true }])
  })

  it('does not fire for an unchanged key', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    const events = captureAxisOptions(plot)
    await plot.update({ config: baseConfig({ xaxis_bottom: { titleVisible: false } }) })
    assert.equal(events.length, 0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Part 3 — the menu widget
// ──────────────────────────────────────────────────────────────────────────────
describe('The axis menu', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('opens a full menu (a row per axis) in the plot area, and a single-axis menu on a strip', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    rightPressAt(plot, PLOT_AREA)
    let el = menuEl(plot)
    assert.isOk(el, 'full menu opened')
    assert.deepEqual(rowNames(el), ['Bottom: Depth (m)', 'Left: Voltage (V)'])
    rightPressAt(plot, BOTTOM_STRIP)
    el = menuEl(plot)
    assert.deepEqual(rowNames(el), ['Bottom: Depth (m)'], 'single-axis menu: that strip only')
  })

  it('lists x/y/z on a 3D full menu and opens a single-axis menu on a 3D strip', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: make3DData(), config: config3D() })
    rightPressAt(plot, PLOT_AREA)
    let el = menuEl(plot)
    assert.equal(rowNames(el).length, 3, 'x, y and z rows')
    orient3D(plot)
    rightPressAt(plot, findStrip(plot))
    el = menuEl(plot)
    assert.equal(rowNames(el).length, 1, 'single-axis menu on a 3D strip')
  })

  it('plot_menu:false opens no full menu but still fires the event', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({}, { plot_menu: false }) })
    const events = captureContextMenu(plot)
    rightPressAt(plot, PLOT_AREA)
    assert.isNull(menuEl(plot), 'no menu')
    assert.equal(events.length, 1, 'event still fired')
  })

  it('axis_menu:false opens no single-axis menu but still fires the event', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({}, { axis_menu: false }) })
    const events = captureContextMenu(plot)
    rightPressAt(plot, BOTTOM_STRIP)
    assert.isNull(menuEl(plot), 'no menu')
    assert.equal(events.length, 1, 'event still fired')
  })

  it('toggling Title sets the config key and reflows the margin', async () => {
    plot = newPlot(container, { margin: { top: 80, right: 80, bottom: 80, left: 80 }, marginWithoutAxis: { top: 20, right: 20, bottom: 20, left: 20 } })
    await plot.update({ data: makeData(), config: baseConfig() })
    const before = plot.margin.bottom
    rightPressAt(plot, BOTTOM_STRIP)
    const box = boxOf(menuEl(plot), 'xaxis_bottom', 'titleVisible')
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    assert.isFalse(plot.getConfig().axes.xaxis_bottom.titleVisible, 'config key set')
    assert.isBelow(plot.margin.bottom, before, 'margin reflowed smaller')
  })

  it('toggling Lock calls setAxisLocked and rebuilds no layers', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const layers = plot.layers
    rightPressAt(plot, BOTTOM_STRIP)
    const box = boxOf(menuEl(plot), 'xaxis_bottom', 'locked')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    assert.isTrue(plot.isAxisLocked('xaxis_bottom'))
    assert.strictEqual(plot.layers, layers, 'same layer array — no rebuild')
  })

  it('Reset view calls resetAxes and closes; Reset axis resets one axis', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.axes.yaxis_left.setDomain([0.3, 0.7])
    // Full menu Reset view → both axes back to data range.
    rightPressAt(plot, PLOT_AREA)
    menuEl(plot).querySelector('button').click()
    assert.isNull(menuEl(plot), 'menu closed')
    assert.closeTo(plot.axes.xaxis_bottom.getDomain()[0], 0, 1e-6)
    assert.closeTo(plot.axes.yaxis_left.getDomain()[0], 0, 1e-6)
    // Single-axis Reset axis → only that axis.
    plot.axes.xaxis_bottom.setDomain([0.2, 0.6])
    plot.axes.yaxis_left.setDomain([0.3, 0.7])
    rightPressAt(plot, BOTTOM_STRIP)
    const btn = menuEl(plot).querySelector('button')
    assert.equal(btn.textContent, 'Reset axis')
    btn.click()
    assert.closeTo(plot.axes.xaxis_bottom.getDomain()[0], 0, 1e-6, 'x reset')
    assert.closeTo(plot.axes.yaxis_left.getDomain()[0], 0.3, 1e-6, 'y left alone')
  })

  it('greys out Labels/Title on a hidden axis but keeps their state; Lock stays live', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig({ xaxis_bottom: { visible: false, tickLabelsVisible: false } }) })
    rightPressAt(plot, PLOT_AREA)
    const el = menuEl(plot)
    assert.isTrue(boxOf(el, 'xaxis_bottom', 'tickLabelsVisible').disabled, 'Labels disabled')
    assert.isTrue(boxOf(el, 'xaxis_bottom', 'titleVisible').disabled, 'Title disabled')
    assert.isFalse(boxOf(el, 'xaxis_bottom', 'tickLabelsVisible').checked, 'Labels keeps its off state')
    assert.isTrue(boxOf(el, 'xaxis_bottom', 'titleVisible').checked, 'Title keeps its on state')
    assert.isFalse(boxOf(el, 'xaxis_bottom', 'locked').disabled, 'Lock stays live on a hidden axis')
  })

  it('Lock shows checked for a same-QK sibling of this plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    // Two x slots (bottom + top) sharing QK_X — one axis to the user, one lock.
    await plot.update({ data: makeData(), config: { layers: [
      { points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_bottom', yAxis: 'yaxis_left' } },
      { points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_top',    yAxis: 'yaxis_left' } },
    ], axes: {} } })
    plot.setAxisLocked('xaxis_top', true)
    rightPressAt(plot, BOTTOM_STRIP)
    assert.isTrue(boxOf(menuEl(plot), 'xaxis_bottom', 'locked').checked, 'same-QK sibling lock shows checked')
  })

  it('Lock stays unchecked for a lock held only on a linked plot', async () => {
    plot = newPlot(container, { margin: MARGIN })
    const container2 = makeContainer()
    const plot2 = newPlot(container2, { margin: MARGIN })
    try {
      await plot.update({ data: makeData(), config: baseConfig() })
      await plot2.update({ data: makeData(), config: baseConfig() })
      linkAxes(plot.axes.yaxis_left, plot2.axes.yaxis_left)
      plot2.setAxisLocked('yaxis_left', true)   // locked on the linked plot only
      rightPressAt(plot, LEFT_STRIP)
      assert.isFalse(boxOf(menuEl(plot), 'yaxis_left', 'locked').checked, 'lock does not follow a link')
    } finally {
      plot2.destroy(); document.body.removeChild(container2)
    }
  })

  it('closes on Escape and on an outside mousedown', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    rightPressAt(plot, PLOT_AREA)
    assert.isOk(menuEl(plot))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    assert.isNull(menuEl(plot), 'Escape closed it')
    rightPressAt(plot, PLOT_AREA)
    assert.isOk(menuEl(plot))
    document.dispatchEvent(new MouseEvent('mousedown', { clientX: 5000, clientY: 5000, bubbles: true }))
    assert.isNull(menuEl(plot), 'outside mousedown closed it')
  })

  it('emits axisoptions once when a menu checkbox toggles Lock', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    const events = []
    plot.on('axisoptions', (e) => events.push(e))
    rightPressAt(plot, BOTTOM_STRIP)
    const box = boxOf(menuEl(plot), 'xaxis_bottom', 'locked')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    assert.deepEqual(events, [{ type: 'axisoptions', axis: 'xaxis_bottom', key: 'locked', value: true }])
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Log column + the colour / 2D / filter table
// ──────────────────────────────────────────────────────────────────────────────
describe('The Log column', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('toggles the axis scale between linear and log', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeData(), config: baseConfig() })
    rightPressAt(plot, BOTTOM_STRIP)
    const box = boxOf(menuEl(plot), 'xaxis_bottom', 'scale')
    assert.isOk(box, 'a Log checkbox exists')
    assert.isFalse(box.checked, 'linear by default')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    assert.equal(plot.getConfig().axes.xaxis_bottom.scale, 'log')
  })
})

describe('The colour / 2D / filter table', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('only the full menu lists colour, 2D and filter rows', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeColorData(), config: colorConfig() })
    rightPressAt(plot, PLOT_AREA)
    assert.isOk(extraRow(`data-color="${QK_C}"`), 'colour axis row')
    assert.isOk(extraRow(`data-color="${QK_C2}"`), 'second colour axis row')
    assert.isOk(extraRow(`data-axis2d="${PAIR}"`), '2D pair row')
    assert.isOk(extraRow(`data-filter="${QK_F}"`), 'filter axis row')
    // A single-axis menu has no extra table.
    rightPressAt(plot, BOTTOM_STRIP)
    assert.isNull(document.querySelector('[data-gladly-control="axis-menu"] [data-table="color-filter"]'))
  })

  it('cycles a colour axis bar none → vertical → horizontal', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeColorData(), config: colorConfig() })
    rightPressAt(plot, PLOT_AREA)
    const bar = ctrl(`data-color="${QK_C}"][data-key="colorbar"`)
    assert.equal(plot.getConfig().axes[QK_C].colorbar, 'none')
    bar.click(); await new Promise(r => setTimeout(r, 0))
    assert.equal(plot.getConfig().axes[QK_C].colorbar, 'vertical')
    bar.click(); await new Promise(r => setTimeout(r, 0))
    assert.equal(plot.getConfig().axes[QK_C].colorbar, 'horizontal')
  })

  it('sets a colour axis colorscale from the dropdown', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeColorData(), config: colorConfig() })
    rightPressAt(plot, PLOT_AREA)
    const sel = ctrl(`data-color="${QK_C}"][data-key="colorscale"`)
    sel.value = 'viridis'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    assert.equal(plot.getConfig().axes[QK_C].colorscale, 'viridis')
  })

  it('toggles 2D-pair enabled and colorbar, and sets its colorscale', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeColorData(), config: colorConfig([{ xAxis: QK_C, yAxis: QK_C2, colorscale: TWOD }]) })
    rightPressAt(plot, PLOT_AREA)
    const enabled = ctrl(`data-axis2d="${PAIR}"][data-key="enabled"`)
    assert.isTrue(enabled.checked, 'enabled by default')
    enabled.checked = false
    enabled.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    assert.isFalse(plot.axis2d[PAIR].getConfig().enabled, 'enabled written false')
    const cbar = ctrl(`data-axis2d="${PAIR}"][data-key="colorbar"`)
    cbar.checked = false
    cbar.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    assert.isFalse(plot.axis2d[PAIR].getConfig().colorbar, 'colorbar written false')
  })

  it('cycles a filter axis bar none → vertical → horizontal', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: makeColorData(), config: colorConfig() })
    rightPressAt(plot, PLOT_AREA)
    const bar = ctrl(`data-filter="${QK_F}"][data-key="filterbar"`)
    bar.click(); await new Promise(r => setTimeout(r, 0))
    assert.equal(plot.getConfig().axes[QK_F].filterbar, 'vertical')
  })
})

describe('3D camera persistence across update()', () => {
  let container, plot
  beforeEach(() => { container = makeContainer() })
  afterEach(() => { plot.destroy(); document.body.removeChild(container) })

  it('keeps the orbit orientation when an axis option changes', async () => {
    plot = newPlot(container, { margin: MARGIN })
    await plot.update({ data: make3DData(), config: config3D() })
    plot._camera._theta = -0.7
    plot._camera._phi = 0.4
    // Any config change re-runs _initialize; the camera must not snap back to default.
    await plot.update({ config: config3D({ xaxis_bottom: { titleVisible: false } }) })
    assert.closeTo(plot._camera._theta, -0.7, 1e-9, 'theta preserved')
    assert.closeTo(plot._camera._phi, 0.4, 1e-9, 'phi preserved')
  })
})
