import { assert } from '@esm-bundle/chai'
import { Plot, LassoInteraction } from '../src/index.js'

// Container 200×200, margin 40 → plot area 120×120 starting at canvas (40, 40).
// Axes 0..100 on both, so data (x, y) sits at canvas (40 + 1.2 x, 160 - 1.2 y).
const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 40, right: 40, bottom: 40, left: 40 }

function makeContainer() {
  const el = document.createElement('div')
  el.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

async function makePlot({ x = [10, 50, 90], y = [50, 50, 50], interactions = { lasso: true } } = {}) {
  const container = makeContainer()
  const plot = new Plot(container, { margin: MARGIN })
  await plot.update({
    data: { input: { x: new Float32Array(x), y: new Float32Array(y) } },
    config: {
      layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush' } }],
      axes: { xaxis_bottom: { min: 0, max: 100 }, yaxis_left: { min: 0, max: 100 } },
      interactions,
    },
  })
  // The ResizeObserver can interrupt the first _initialize; a second pass completes it.
  await plot.forceUpdate()
  return { container, plot }
}

function mouse(plot, type, [x, y], opts = {}) {
  const r = plot._canvas.getBoundingClientRect()
  const ev = new MouseEvent(type, {
    clientX: r.left + x, clientY: r.top + y,
    bubbles: true, cancelable: true, button: 0, shiftKey: true, ...opts,
  })
  ;(type === 'mousedown' || type === 'wheel' ? plot._canvas : window).dispatchEvent(ev)
}

function drag(plot, from, to, opts = {}) {
  mouse(plot, 'mousedown', from, opts)
  mouse(plot, 'mousemove', to, opts)
  mouse(plot, 'mouseup', to, opts)
}

function click(plot, at, opts = {}) {
  mouse(plot, 'mousedown', at, opts)
  mouse(plot, 'mouseup', at, opts)
}

function rightClick(plot, at) {
  mouse(plot, 'mousedown', at, { button: 2, shiftKey: false })
  mouse(plot, 'mouseup', at, { button: 2, shiftKey: false })
}

function assertPoint(actual, expected, msg) {
  assert.closeTo(actual[0], expected[0], 1e-6, msg)
  assert.closeTo(actual[1], expected[1], 1e-6, msg)
}

// ─── Vertex lists handed to selectLasso ───────────────────────────────────────

describe('Lasso modes: vertices handed to selectLasso', () => {
  let container, plot, calls

  beforeEach(async () => {
    ({ container, plot } = await makePlot())
    calls = []
    plot.selectLasso = async (vertices) => { calls.push(vertices) }
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('lasso: a Shift+drag records the free-hand path', () => {
    mouse(plot, 'mousedown', [50, 50])
    mouse(plot, 'mousemove', [100, 50])
    mouse(plot, 'mousemove', [100, 100])
    mouse(plot, 'mouseup', [100, 100])
    assert.deepEqual(calls, [[[50, 50], [100, 50], [100, 100]]])
  })

  it('rectangle: press and release are opposite corners, sides along the axes', () => {
    plot.setLassoMode('rectangle')
    drag(plot, [50, 60], [110, 100])
    assert.deepEqual(calls, [[[50, 60], [110, 60], [110, 100], [50, 100]]])
  })

  it('triangle: the third corner mirrors the dragged one across the apex vertical', () => {
    plot.setLassoMode('triangle')
    drag(plot, [100, 50], [130, 120])
    assert.deepEqual(calls, [[[100, 50], [130, 120], [70, 120]]])
  })

  it('circle: a ring around the press point through the release point', () => {
    plot.setLassoMode('circle')
    drag(plot, [100, 100], [130, 100])
    assert.lengthOf(calls, 1)
    assert.lengthOf(calls[0], 64)
    for (const [x, y] of calls[0]) assert.closeTo(Math.hypot(x - 100, y - 100), 30, 1e-6)
  })

  it('polygon: Shift-clicks place corners and a right-click closes without adding one', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    click(plot, [120, 140])
    click(plot, [60, 130])
    assert.lengthOf(calls, 0)
    rightClick(plot, [10, 10])
    assert.deepEqual(calls, [[[50, 50], [150, 60], [120, 140], [60, 130]]])
  })

  it('polygon: a right-click with fewer than three corners selects nothing', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    rightClick(plot, [10, 10])
    assert.lengthOf(calls, 0)
  })

  it('polygon: Escape abandons the corners placed', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    click(plot, [120, 140])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    rightClick(plot, [10, 10])
    assert.lengthOf(calls, 0)
  })

  it('polygon: a click without Shift abandons the corners placed', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    click(plot, [120, 140])
    click(plot, [100, 100], { shiftKey: false })
    rightClick(plot, [10, 10])
    assert.lengthOf(calls, 0)
  })

  it('polygon: a wheel event abandons the corners placed', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    click(plot, [120, 140])
    plot._canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }))
    rightClick(plot, [10, 10])
    assert.lengthOf(calls, 0)
  })

  it('polygon: a mode change abandons the corners placed', () => {
    plot.setLassoMode('polygon')
    click(plot, [50, 50])
    click(plot, [150, 60])
    click(plot, [120, 140])
    plot.setLassoMode('polygon')
    rightClick(plot, [10, 10])
    assert.lengthOf(calls, 0)
  })

  it('ellipse: center, end of the first axis, then the second axis length', () => {
    plot.setLassoMode('ellipse')
    click(plot, [100, 100])
    click(plot, [140, 100])
    assert.lengthOf(calls, 0)
    click(plot, [110, 80])   // 20 px from the first axis's line
    assert.lengthOf(calls, 1)
    assert.lengthOf(calls[0], 64)
    assertPoint(calls[0][0], [140, 100], 'end of the first axis')
    assertPoint(calls[0][16], [100, 120], 'end of the second axis')
  })

  it('ellipse: the first axis may point any way; the second is measured square to it', () => {
    plot.setLassoMode('ellipse')
    click(plot, [100, 100])
    click(plot, [100, 140])   // first axis straight down the canvas
    click(plot, [125, 130])   // 25 px from that axis, whatever its height
    assertPoint(calls[0][0], [100, 140], 'end of the first axis')
    assertPoint(calls[0][16], [75, 100], 'end of the second axis')
  })

  it('ellipse: Escape abandons it part way', () => {
    plot.setLassoMode('ellipse')
    click(plot, [100, 100])
    click(plot, [140, 100])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    click(plot, [110, 80])
    click(plot, [120, 80])
    assert.lengthOf(calls, 0)
  })

  it('band: a mostly-horizontal drag selects the full-height strip between press and release', () => {
    plot.setLassoMode('band')
    drag(plot, [60, 90], [150, 60])   // dx 90 > dy 30 → vertical strip
    assert.lengthOf(calls, 1)
    const xs = calls[0].map(v => v[0]), ys = calls[0].map(v => v[1])
    assert.sameMembers([...new Set(xs)], [60, 150])
    assert.isBelow(Math.min(...ys), -HEIGHT)
    assert.isAbove(Math.max(...ys), 2 * HEIGHT)
  })

  it('band: a mostly-vertical drag selects the full-width strip between press and release', () => {
    plot.setLassoMode('band')
    drag(plot, [90, 60], [60, 150])   // dy 90 > dx 30 → horizontal strip
    assert.lengthOf(calls, 1)
    const xs = calls[0].map(v => v[0]), ys = calls[0].map(v => v[1])
    assert.sameMembers([...new Set(ys)], [60, 150])
    assert.isBelow(Math.min(...xs), -WIDTH)
    assert.isAbove(Math.max(...xs), 2 * WIDTH)
  })

  it('band: a click selects a strip of the set width, in x data units, centered on it', () => {
    plot.setLassoMode('band', { bandWidth: 10 })
    click(plot, [100, 100])   // data x = 50, so the strip covers data 45..55
    assert.lengthOf(calls, 1)
    const xs = [...new Set(calls[0].map(v => v[0]))].sort((a, b) => a - b)
    assert.closeTo(xs[0], 40 + 1.2 * 45, 1e-6)
    assert.closeTo(xs[1], 40 + 1.2 * 55, 1e-6)
  })

  it('band: a click with no width set selects nothing', () => {
    plot.setLassoMode('band')
    click(plot, [100, 100])
    assert.lengthOf(calls, 0)
  })

  it('a click, or a shape flatter than 5 px, selects nothing', () => {
    for (const mode of ['rectangle', 'triangle']) {
      plot.setLassoMode(mode)
      click(plot, [100, 100])
      drag(plot, [100, 100], [103, 150])
      drag(plot, [100, 100], [150, 102])
    }
    plot.setLassoMode('circle')
    click(plot, [100, 100])
    drag(plot, [100, 100], [103, 102])
    plot.setLassoMode('ellipse')
    click(plot, [100, 100])
    click(plot, [140, 100])
    click(plot, [120, 102])   // 2 px from the first axis
    assert.lengthOf(calls, 0)
  })

  it('a drag without the trigger selects nothing', () => {
    plot.setLassoMode('rectangle')
    drag(plot, [50, 60], [110, 100], { shiftKey: false })
    assert.lengthOf(calls, 0)
  })
})

// ─── Mode handling ────────────────────────────────────────────────────────────

describe('Lasso modes: setting the mode', () => {
  let container, plot

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('an unknown mode throws, from setLassoMode and from the constructor', async () => {
    ({ container, plot } = await makePlot())
    assert.throws(() => plot.setLassoMode('hexagon'), /Unknown lasso mode 'hexagon'/)
    assert.throws(() => new LassoInteraction(plot, { selectionName: 'brush', mode: 'hexagon' }), /Unknown lasso mode/)
  })

  it('setLassoMode survives a later update(), band width included', async () => {
    ({ container, plot } = await makePlot())
    plot.setLassoMode('band', { bandWidth: 25 })
    await plot.forceUpdate()
    assert.equal(plot._interactions[0].mode, 'band')
    assert.equal(plot._interactions[0].bandWidth, 25)
  })

  it('an interactions.lasso item can set its own mode and band width', async () => {
    ({ container, plot } = await makePlot({ interactions: { lasso: [{ selection: 'brush', mode: 'circle', bandWidth: 5 }] } }))
    assert.equal(plot._interactions[0].mode, 'circle')
    assert.equal(plot._interactions[0].bandWidth, 5)
  })
})

// ─── End to end, through the GPU selection pipeline ───────────────────────────

function nextSelection(plot) {
  return new Promise(resolve => {
    const handle = plot.selections.brush.subscribe(sel => {
      handle.remove()
      resolve(Array.from(sel.arrays[0]))
    })
  })
}

describe('Lasso modes: selection end to end', () => {
  let container, plot

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('a rectangle around one point selects exactly that point', async () => {
    ({ container, plot } = await makePlot())   // points at canvas (52, 100), (100, 100), (148, 100)
    plot.setLassoMode('rectangle')
    const selected = nextSelection(plot)
    drag(plot, [90, 90], [110, 110])
    assert.deepEqual(await selected, [0, 1, 0])
  })

  it('a band click selects the points in its x range, including those zoomed out of view in y', async () => {
    ({ container, plot } = await makePlot({ x: [10, 50, 50, 90], y: [50, 50, 500, 50] }))   // y = 500 is off the plot
    plot.setLassoMode('band', { bandWidth: 10 })
    const selected = nextSelection(plot)
    click(plot, [100, 100])
    assert.deepEqual(await selected, [0, 1, 1, 0])
  })
})
