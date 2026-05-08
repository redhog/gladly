import { assert } from '@esm-bundle/chai'
import { Plot } from '../src/index.js'

const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }
const PLOT_W = WIDTH  - MARGIN.left - MARGIN.right   // 80
const PLOT_H = HEIGHT - MARGIN.top  - MARGIN.bottom  // 80

function makeContainer() {
  const el = document.createElement('div')
  el.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

function makeData(n = 100) {
  const x = new Float32Array(n), y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i / (n - 1)
    y[i] = 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2)
  }
  return { x, y }
}

// ─── Plot.schema() ────────────────────────────────────────────────────────────

describe('Plot.schema()', () => {
  it('returns an object with type "object"', () => {
    const s = Plot.schema()
    assert.isObject(s)
    assert.equal(s.type, 'object')
  })

  it('has a layers property in its schema', () => {
    const s = Plot.schema()
    assert.isObject(s.properties)
    assert.isObject(s.properties.layers)
  })

  it('has an axes property in its schema', () => {
    const s = Plot.schema()
    assert.isObject(s.properties.axes)
  })

  it('includes $defs for registered layer types', () => {
    const s = Plot.schema()
    // points and lines are always registered
    const json = JSON.stringify(s)
    assert.include(json, 'points')
  })
})

// ─── plot.getConfig() ─────────────────────────────────────────────────────────

describe('plot.getConfig()', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('returns an object with layers and axes after update()', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    const cfg = plot.getConfig()
    assert.isObject(cfg)
    assert.isArray(cfg.layers)
    assert.isObject(cfg.axes)
  })

  it('axes in getConfig() include live min/max from explicit axis config', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y' } }],
        axes:   { xaxis_bottom: { min: 0, max: 100 } },
      },
    })
    const cfg = plot.getConfig()
    assert.closeTo(cfg.axes.xaxis_bottom.min, 0,   0.001)
    assert.closeTo(cfg.axes.xaxis_bottom.max, 100, 0.001)
  })

  it('getConfig().axes reflects a domain changed via axis.setDomain()', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    plot.axes.xaxis_bottom.setDomain([7, 77])
    const cfg = plot.getConfig()
    assert.closeTo(cfg.axes.xaxis_bottom.min, 7,  0.001)
    assert.closeTo(cfg.axes.xaxis_bottom.max, 77, 0.001)
  })

  it('config passed to update() is round-tripped in getConfig().layers', async () => {
    const layerSpec = { points: { xData: 'input.x', yData: 'input.y' } }
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [layerSpec] },
    })
    assert.deepEqual(plot.getConfig().layers[0], layerSpec)
  })
})

// ─── plot.lookup() ────────────────────────────────────────────────────────────

describe('plot.lookup()', () => {
  let container, plot

  // Container: 200×200, margin 60 → plot area 80×80.
  // x domain [0, 100] with D3 range [0, 80]  → left edge x=0, right edge x=100.
  // y domain [0, 100] with D3 range [80, 0]  → top  edge y=100, bottom edge y=0.

  beforeEach(async () => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y' } }],
        axes:   { xaxis_bottom: { min: 0, max: 100 }, yaxis_left: { min: 0, max: 100 } },
      },
    })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('returns an object with axis-name keys', () => {
    const coords = plot.lookup(WIDTH / 2, HEIGHT / 2)
    assert.isObject(coords)
    assert.property(coords, 'xaxis_bottom')
    assert.property(coords, 'yaxis_left')
  })

  it('left margin edge → x = 0', () => {
    const coords = plot.lookup(MARGIN.left, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 0, 0.1)
  })

  it('right margin edge → x = 100', () => {
    const coords = plot.lookup(WIDTH - MARGIN.right, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 100, 0.1)
  })

  it('horizontal centre → x ≈ 50', () => {
    const coords = plot.lookup(MARGIN.left + PLOT_W / 2, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 50, 0.5)
  })

  it('top margin edge → y = 100 (y domain is inverted in screen space)', () => {
    const coords = plot.lookup(WIDTH / 2, MARGIN.top)
    assert.closeTo(coords.yaxis_left, 100, 0.1)
  })

  it('bottom margin edge → y = 0', () => {
    const coords = plot.lookup(WIDTH / 2, HEIGHT - MARGIN.bottom)
    assert.closeTo(coords.yaxis_left, 0, 0.1)
  })

  it('vertical centre → y ≈ 50', () => {
    const coords = plot.lookup(WIDTH / 2, MARGIN.top + PLOT_H / 2)
    assert.closeTo(coords.yaxis_left, 50, 0.5)
  })

  it('lookup() before update() returns an empty object', async () => {
    const c2 = makeContainer()
    const p2 = new Plot(c2)
    const coords = p2.lookup(50, 50)
    assert.isObject(coords)
    assert.isEmpty(Object.keys(coords))
    p2.destroy()
    document.body.removeChild(c2)
  })

  it('axis name and quantity-kind key map to the same value', () => {
    const coords = plot.lookup(WIDTH / 2, HEIGHT / 2)
    // The QK for 'input.x' resolves to 'input.x', so that key is also present.
    if ('input.x' in coords) {
      assert.equal(coords['input.x'], coords.xaxis_bottom)
    }
  })
})

// ─── plot.on() ────────────────────────────────────────────────────────────────

describe('plot.on()', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('on("error", cb) returns a handle with a remove() method', () => {
    const handle = plot.on('error', () => {})
    assert.isObject(handle)
    assert.isFunction(handle.remove)
    handle.remove()
  })

  it('on("error", cb) fires when a layer fails to create', async () => {
    const errors = []
    plot.on('error', (e) => errors.push(e))
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ bars: { xData: 'nonexistent.x', yData: 'nonexistent.y' } }] },
    })
    assert.isAbove(errors.length, 0)
    assert.include(errors[0].message.toLowerCase(), 'failed to create')
  })

  it('on("error", cb).remove() stops the callback from receiving future errors', async () => {
    const errors = []
    const handle = plot.on('error', (e) => errors.push(e))
    handle.remove()
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ bars: { xData: 'nonexistent.x', yData: 'nonexistent.y' } }] },
    })
    assert.isEmpty(errors)
  })

  it('on("no-error", cb) returns a handle with a remove() method', () => {
    const handle = plot.on('no-error', () => {})
    assert.isFunction(handle.remove)
    handle.remove()
  })

  it('on(DOM event) returns a handle with a remove() method', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    const handle = plot.on('click', () => {})
    assert.isFunction(handle.remove)
    handle.remove()
  })

  it('on(DOM event) callback fires when an event whose target is the canvas', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    let callCount = 0
    const handle = plot.on('click', () => { callCount++ })
    plot.canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    handle.remove()
    assert.equal(callCount, 1)
  })

  it('callback receives (rawEvent, coords) for a DOM event', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    let receivedEvent, receivedCoords
    const handle = plot.on('click', (e, c) => { receivedEvent = e; receivedCoords = c })
    plot.canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    handle.remove()
    assert.instanceOf(receivedEvent, MouseEvent)
    assert.isObject(receivedCoords)
  })

  it('on(DOM event) callback does not fire after remove()', async () => {
    await plot.update({
      data:   { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    let callCount = 0
    const handle = plot.on('click', () => { callCount++ })
    handle.remove()
    plot.canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(callCount, 0)
  })
})
