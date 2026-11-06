import { assert } from '@esm-bundle/chai'
import { Plot, Colorbar, linkAxes, registerAxisQuantityKind } from '../src/index.js'
import { parseAxisLimit } from '../src/axes/AxisLimitEditor.js'

// Container 200×200, margin 60 → plot area 80×80, from 60 to 140 on both axes.
// The bottom axis band is below y = 140 and between x = 60 and 140; the left axis band
// is left of x = 60 and between y = 60 and 140.
const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }

function makeContainer(w = WIDTH, h = HEIGHT) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

function makeData(n = 100) {
  const x = new Float32Array(n), y = new Float32Array(n), v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = 1 + i
    y[i] = 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2)
    v[i] = i / (n - 1)
  }
  return { x, y, v }
}

// Move the pointer to container pixel (mx, my) over the plot's canvas.
function hover(plot, mx, my) {
  const rect = plot.container.getBoundingClientRect()
  plot._canvas.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, clientX: rect.left + mx, clientY: rect.top + my,
  }))
}

function box(plot, axis, end) {
  return plot.container.querySelector(`[data-gladly-control="axis-limit"][data-axis="${axis}"][data-end="${end}"]`)
}

function shown(el) {
  return !!el && el.style.display !== 'none'
}

function shownBoxes(plot) {
  return [...plot.container.querySelectorAll('[data-gladly-control="axis-limit"]')].filter(shown)
}

// Hover the axis band, click the box at `end` and return its text field.
function openEditor(plot, axis, end, at) {
  hover(plot, ...at)
  box(plot, axis, end).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const input = box(plot, axis, end).querySelector('input')
  assert.ok(input, 'the box turned into a text field')
  return input
}

function type(input, text, key = 'Enter') {
  input.value = text
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

const BOTTOM_BAND = [100, 150]
const LEFT_BAND   = [30, 100]
const PLOT_AREA   = [100, 100]

// ─── parseAxisLimit ───────────────────────────────────────────────────────────

describe('parseAxisLimit()', () => {
  it('accepts a plain number and e-notation', () => {
    assert.deepEqual(parseAxisLimit('25', 0, 100, false), { value: 25 })
    assert.deepEqual(parseAxisLimit(' 1e-4 ', 0.001, 1, true), { value: 1e-4 })
  })

  it('refuses text that is not a number, and an empty field', () => {
    assert.property(parseAxisLimit('abc', 0, 100, false), 'error')
    assert.property(parseAxisLimit('12abc', 0, 100, false), 'error')
    assert.property(parseAxisLimit('', 0, 100, false), 'error')
  })

  it('refuses the other end\'s value', () => {
    assert.property(parseAxisLimit('100', 0, 100, false), 'error')
  })

  it('refuses a value that would flip the axis, in either direction', () => {
    assert.property(parseAxisLimit('150', 0, 100, false), 'error')    // min above max
    assert.property(parseAxisLimit('-5', 100, 0, false), 'error')     // reversed axis made normal
    assert.deepEqual(parseAxisLimit('50', 100, 0, false), { value: 50 })
  })

  it('refuses zero and below on a log axis only', () => {
    assert.property(parseAxisLimit('0', 1, 100, true), 'error')
    assert.property(parseAxisLimit('-1', 1, 100, true), 'error')
    assert.deepEqual(parseAxisLimit('-1', 1, 100, false), { value: -1 })
  })
})

// ─── Boxes on a 2D plot ───────────────────────────────────────────────────────

describe('AxisLimitEditor', () => {
  let container, plot

  beforeEach(async () => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y' } }],
        axes:   { xaxis_bottom: { min: 0, max: 100 }, yaxis_left: { min: 0, max: 1 } },
      },
    })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('shows the two end values of the axis under the pointer, and hides them off the band', () => {
    hover(plot, ...BOTTOM_BAND)
    assert.deepEqual(shownBoxes(plot).map(b => [b.dataset.axis, b.dataset.end]),
      [['xaxis_bottom', 'min'], ['xaxis_bottom', 'max']])
    assert.equal(box(plot, 'xaxis_bottom', 'min').textContent, '0')
    assert.equal(box(plot, 'xaxis_bottom', 'max').textContent, '100')

    hover(plot, ...LEFT_BAND)
    assert.deepEqual(shownBoxes(plot).map(b => [b.dataset.axis, b.dataset.end]),
      [['yaxis_left', 'min'], ['yaxis_left', 'max']])

    hover(plot, ...PLOT_AREA)
    assert.lengthOf(shownBoxes(plot), 0)
  })

  it('places the boxes at the axis ends, min at the bottom or left', () => {
    hover(plot, ...BOTTOM_BAND)
    const minBox = box(plot, 'xaxis_bottom', 'min').getBoundingClientRect()
    const maxBox = box(plot, 'xaxis_bottom', 'max').getBoundingClientRect()
    const rect = container.getBoundingClientRect()
    assert.closeTo((minBox.left + minBox.right) / 2 - rect.left, MARGIN.left, 1)
    assert.closeTo((maxBox.left + maxBox.right) / 2 - rect.left, WIDTH - MARGIN.right, 1)

    hover(plot, ...LEFT_BAND)
    const lo = box(plot, 'yaxis_left', 'min').getBoundingClientRect()
    const hi = box(plot, 'yaxis_left', 'max').getBoundingClientRect()
    assert.isAbove(lo.top, hi.top)
  })

  it('Enter sets the end through the axis and fires one axislimit event', () => {
    const events = []
    plot.on('axislimit', (e) => events.push(e))
    type(openEditor(plot, 'xaxis_bottom', 'min', BOTTOM_BAND), '25')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [25, 100])
    assert.closeTo(plot.getConfig().axes.xaxis_bottom.min, 25, 1e-9)
    assert.lengthOf(events, 1)
    assert.deepInclude(events[0], { type: 'axislimit', axis: 'xaxis_bottom', end: 'min', value: 25, domain: [25, 100] })
    assert.isNull(box(plot, 'xaxis_bottom', 'min').querySelector('input'))
  })

  it('Escape leaves the domain alone and fires nothing', () => {
    const events = []
    plot.on('axislimit', (e) => events.push(e))
    type(openEditor(plot, 'xaxis_bottom', 'max', BOTTOM_BAND), '50', 'Escape')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0, 100])
    assert.lengthOf(events, 0)
  })

  it('an invalid value on Enter keeps the field open and changes nothing', () => {
    const events = []
    plot.on('axislimit', (e) => events.push(e))
    const input = openEditor(plot, 'xaxis_bottom', 'min', BOTTOM_BAND)
    type(input, '150')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0, 100])
    assert.lengthOf(events, 0)
    assert.equal(box(plot, 'xaxis_bottom', 'min').querySelector('input'), input)
    assert.match(box(plot, 'xaxis_bottom', 'min').title, /below the other end/)
  })

  it('leaving the field sets a valid value and drops an invalid one', () => {
    let input = openEditor(plot, 'xaxis_bottom', 'max', BOTTOM_BAND)
    input.value = '80'
    input.dispatchEvent(new FocusEvent('blur'))
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0, 80])

    input = openEditor(plot, 'xaxis_bottom', 'max', BOTTOM_BAND)
    input.value = 'nonsense'
    input.dispatchEvent(new FocusEvent('blur'))
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0, 80])
    assert.isNull(box(plot, 'xaxis_bottom', 'max').querySelector('input'))
  })

  it('Tab sets the value and opens the other end of the same axis', () => {
    type(openEditor(plot, 'xaxis_bottom', 'min', BOTTOM_BAND), '10', 'Tab')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [10, 100])
    const next = box(plot, 'xaxis_bottom', 'max').querySelector('input')
    assert.ok(next, 'the max end is open')
    type(next, '90')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [10, 90])
  })

  it('pressing Enter on the unchanged value changes nothing', () => {
    const events = []
    plot.on('axislimit', (e) => events.push(e))
    plot.axes.xaxis_bottom.setDomain([0.1234567891, 100])
    const input = openEditor(plot, 'xaxis_bottom', 'min', BOTTOM_BAND)
    assert.equal(input.value, '0.123457')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0.1234567891, 100])
    assert.lengthOf(events, 0)
  })

  it('keeps a reversed axis reversed', () => {
    plot.axes.yaxis_left.setDomain([1, 0])
    type(openEditor(plot, 'yaxis_left', 'min', LEFT_BAND), '-0.5')
    assert.deepEqual(plot.axes.yaxis_left.getDomain(), [1, 0])
    type(box(plot, 'yaxis_left', 'min').querySelector('input'), '0.8')
    assert.deepEqual(plot.axes.yaxis_left.getDomain(), [0.8, 0])
  })

  it('a click on a box does not reach plot.on("click") listeners', () => {
    let clicks = 0
    const handle = plot.on('click', () => { clicks++ })
    hover(plot, ...BOTTOM_BAND)
    box(plot, 'xaxis_bottom', 'min').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    plot._canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    handle.remove()
    assert.equal(clicks, 1)
  })

  it('removes its boxes on destroy()', () => {
    hover(plot, ...BOTTOM_BAND)
    assert.isAbove(container.querySelectorAll('[data-gladly-control]').length, 0)
    plot.destroy()
    assert.lengthOf(container.querySelectorAll('[data-gladly-control]'), 0)
    plot = new Plot(container, { margin: MARGIN })   // for afterEach
  })
})

describe('AxisLimitEditor — axes that get no boxes, or refuse values', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('shows nothing for a hidden axis', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y' } }],
        axes:   { yaxis_left: { visible: false } },
      },
    })
    hover(plot, ...LEFT_BAND)
    assert.lengthOf(shownBoxes(plot), 0)
  })

  it('shows nothing on a 3D plot', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y', zData: 'input.v' } }] },
    })
    assert.isTrue(plot._is3D)
    hover(plot, ...BOTTOM_BAND)
    assert.lengthOf(shownBoxes(plot), 0)
  })

  it('refuses zero on a log axis and accepts e-notation', async () => {
    registerAxisQuantityKind('limit_test_log.x', { scale: 'log' })
    await plot.update({
      data:   { limit_test_log: makeData() },
      config: {
        layers: [{ points: { xData: 'limit_test_log.x', yData: 'limit_test_log.y' } }],
        axes:   { xaxis_bottom: { min: 1, max: 100 } },
      },
    })
    assert.isTrue(plot.axisRegistry.isLogScale('xaxis_bottom'))
    const input = openEditor(plot, 'xaxis_bottom', 'min', BOTTOM_BAND)
    type(input, '0')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [1, 100])
    type(input, '1e-2')
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [0.01, 100])
  })
})

// ─── Links and floats ─────────────────────────────────────────────────────────

describe('AxisLimitEditor — linked axes and colorbars', () => {
  const COLOR_QK = 'input.v'
  let cA, cB, cBar, a, b, colorbar

  beforeEach(async () => {
    cA = makeContainer(); cB = makeContainer(); cBar = makeContainer(300, 80)
    a = new Plot(cA, { margin: MARGIN })
    b = new Plot(cB, { margin: MARGIN })
    const config = {
      layers: [{ points: { xData: 'input.x', yData: 'input.y', vData: 'input.v' } }],
      axes:   { xaxis_bottom: { min: 0, max: 100 }, [COLOR_QK]: { min: 0, max: 1 } },
    }
    await a.update({ data: { input: makeData() }, config })
    await b.update({ data: { input: makeData() }, config })
    colorbar = new Colorbar(cBar, a, COLOR_QK, { orientation: 'horizontal' })
    await colorbar.forceUpdate()
  })

  afterEach(() => {
    colorbar.destroy(); a.destroy(); b.destroy()
    for (const c of [cA, cB, cBar]) document.body.removeChild(c)
  })

  it('a linked axis on another plot follows a typed value', () => {
    const link = linkAxes(a.axes.xaxis_bottom, b.axes.xaxis_bottom)
    type(openEditor(a, 'xaxis_bottom', 'max', BOTTOM_BAND), '60')
    link.unlink()
    assert.deepEqual(b.axes.xaxis_bottom.getDomain(), [0, 60])
  })

  it('a value typed on the colorbar sets the color range and fires axislimit on the target', () => {
    const events = []
    a.on('axislimit', (e) => events.push(e))
    // Horizontal colorbar, 300×80, margin { top: 5, right: 40, bottom: 45, left: 40 }:
    // its axis band is below y = 35, between x = 40 and 260.
    type(openEditor(colorbar, 'xaxis_bottom', 'max', [150, 50]), '0.5')
    const domain = a.getAxisDomain(COLOR_QK)
    assert.closeTo(domain[0], 0, 1e-9)
    assert.closeTo(domain[1], 0.5, 1e-9)
    assert.lengthOf(events, 1)
    assert.deepInclude(events[0], { axis: COLOR_QK, end: 'max', value: 0.5 })
  })
})
