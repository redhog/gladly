import { assert } from '@esm-bundle/chai'
import { Plot } from '../src/index.js'

// Container 300×200. A side that draws an axis gets MARGIN, a side that draws none
// gets NARROW, so a plot with axes on the bottom and left has a plot area of
// 300 − 60 − 20 = 220 wide and 200 − 10 − 60 = 130 high.
const WIDTH = 300, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }
const NARROW = { top: 10, right: 20, bottom: 10, left: 20 }

function makeContainer() {
  const el = document.createElement('div')
  el.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

function makeData(n = 100) {
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i / (n - 1)
    y[i] = 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2)
    z[i] = 0.5
  }
  return { x, y, z }
}

function config(points = {}, axes = {}) {
  return {
    layers: [{ points: { xData: 'input.x', yData: 'input.y', ...points } }],
    axes:   { xaxis_bottom: { min: 0, max: 100 }, yaxis_left: { min: 0, max: 100 }, ...axes },
  }
}

describe('marginWithoutAxis', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('without it, every side keeps margin', async () => {
    plot = new Plot(container, { margin: MARGIN })
    await plot.update({ data: { input: makeData() }, config: config() })
    assert.deepEqual(plot.margin, MARGIN)
    assert.equal(plot.plotWidth, WIDTH - 120)
    assert.equal(plot.plotHeight, HEIGHT - 120)
  })

  it('narrows the sides that draw no axis', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    await plot.update({ data: { input: makeData() }, config: config() })
    assert.deepEqual(plot.margin, { top: 10, right: 20, bottom: 60, left: 60 })
    assert.equal(plot.plotWidth, 220)
    assert.equal(plot.plotHeight, 130)
  })

  it('keeps margin on the sides whose axes are drawn, on top and right too', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y', xAxis: 'xaxis_top', yAxis: 'yaxis_right' } }],
        axes:   { xaxis_top: { min: 0, max: 100 }, yaxis_right: { min: 0, max: 100 } },
      },
    })
    assert.deepEqual(plot.margin, { top: 60, right: 60, bottom: 10, left: 20 })
  })

  it('counts an axis hidden with visible: false as not drawn', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    await plot.update({
      data:   { input: makeData() },
      config: config({}, { xaxis_bottom: { min: 0, max: 100, visible: false } }),
    })
    assert.deepEqual(plot.margin, { top: 10, right: 20, bottom: 10, left: 60 })
  })

  it('uses margin for a side it leaves out', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: { top: 10 } })
    await plot.update({ data: { input: makeData() }, config: config() })
    assert.deepEqual(plot.margin, { top: 10, right: 60, bottom: 60, left: 60 })
  })

  it('follows the axes of each update', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    const data = { input: makeData() }
    await plot.update({ data, config: config({}, { xaxis_bottom: { min: 0, max: 100, visible: false } }) })
    assert.equal(plot.margin.bottom, 10)
    await plot.update({ data, config: config() })
    assert.equal(plot.margin.bottom, 60)
  })

  it('keeps margin on every side of a 3D plot', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    await plot.update({
      data:   { input: makeData() },
      config: config({ zData: 'input.z' }, { zaxis_bottom_left: { min: 0, max: 1 } }),
    })
    assert.deepEqual(plot.margin, MARGIN)
  })

  it('lookup() maps the edges of the narrowed plot area to the axis ends', async () => {
    plot = new Plot(container, { margin: MARGIN, marginWithoutAxis: NARROW })
    await plot.update({ data: { input: makeData() }, config: config() })
    assert.closeTo(plot.lookup(60, HEIGHT / 2).xaxis_bottom, 0, 0.1)
    assert.closeTo(plot.lookup(WIDTH - 20, HEIGHT / 2).xaxis_bottom, 100, 0.1)
    assert.closeTo(plot.lookup(WIDTH / 2, 10).yaxis_left, 100, 0.1)
    assert.closeTo(plot.lookup(WIDTH / 2, HEIGHT - 60).yaxis_left, 0, 0.1)
  })
})
