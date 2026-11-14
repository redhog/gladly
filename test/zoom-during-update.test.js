import { assert } from '@esm-bundle/chai'
import { Plot, LayerType, registerLayerType, linkAxes } from '../src/index.js'

// update() is async: it builds a fresh axis registry, whose axes hold d3's placeholder
// ranges until the layers are built. These tests hold an update at layer creation, the
// way a slow layer or a background tab does, and check what zoom and links do meanwhile.

const MARGIN = { top: 20, right: 20, bottom: 20, left: 20 }
const LIMITS = { xaxis_bottom: { min: 0, max: 100 }, yaxis_left: { min: 0, max: 100 } }

// createLayer waits on `gate`, which a test can hold closed.
let gate = Promise.resolve()

registerLayerType('test_gated', new LayerType({
  name: 'test_gated',
  xAxis: 'xaxis_bottom', xAxisQuantityKind: 'test_x',
  yAxis: 'yaxis_left',   yAxisQuantityKind: 'test_y',
  vert: `#version 300 es
precision mediump float;
in float x;
in float y;
void main() { gl_Position = plot_pos(vec2(x, y)); }`,
  frag: `#version 300 es
precision mediump float;
void main() { fragColor = gladly_apply_color(vec4(0.0, 0.0, 0.0, 1.0)); }`,
  schema: () => ({ type: 'object', properties: {} }),
  createLayer: async () => {
    await gate
    return [{
      attributes: { x: new Float32Array([0, 100]), y: new Float32Array([0, 100]) },
      uniforms: {},
      domains: { test_x: [0, 100], test_y: [0, 100] },
      primitive: 'line strip',
      vertexCount: 2,
    }]
  },
}))

function makeContainer() {
  const el = document.createElement('div')
  el.style.cssText = 'width:200px;height:200px;position:absolute;left:-9999px'
  document.body.appendChild(el)
  return el
}

function wheel(plot, deltaY = -100) {
  const r = plot._canvas.getBoundingClientRect()
  plot._canvas.dispatchEvent(new WheelEvent('wheel', {
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY, bubbles: true, cancelable: true,
  }))
}

const tick = () => new Promise(r => setTimeout(r, 0))

// Closes the gate and starts a full rebuild of `plot`; resolves once the rebuild has made
// its axes and is waiting in createLayer. Returns { open, done }.
async function holdUpdate(plot) {
  let open
  gate = new Promise(r => { open = r })
  const done = plot.forceUpdate()
  for (let i = 0; i < 100 && !plot.axisRegistry.getScale('xaxis_bottom'); i++) await tick()
  assert.isOk(plot.axisRegistry.getScale('xaxis_bottom'), 'the update reached layer creation')
  return { open: () => { open(); gate = Promise.resolve() }, done }
}

describe('Zoom and links while an update is in flight', () => {
  let containers, a, b

  beforeEach(async () => {
    gate = Promise.resolve()
    containers = [makeContainer(), makeContainer()]
    ;[a, b] = containers.map(c => new Plot(c, { margin: MARGIN }))
    for (const p of [a, b]) {
      await p.update({ data: { input: {} }, config: { layers: [{ test_gated: {} }], axes: LIMITS } })
    }
    // Let the ResizeObserver's first update run now rather than in the middle of a test.
    await new Promise(r => setTimeout(r, 100))
    linkAxes(a.axes.xaxis_bottom, b.axes.xaxis_bottom)
    linkAxes(a.axes.yaxis_left, b.axes.yaxis_left)
  })

  afterEach(() => {
    gate = Promise.resolve()
    a.destroy()
    b.destroy()
    for (const c of containers) document.body.removeChild(c)
  })

  it('a wheel on a plot that is still updating leaves its linked axes alone', async () => {
    const { open, done } = await holdUpdate(a)
    wheel(a)
    assert.deepEqual(b.axes.xaxis_bottom.getDomain(), [0, 100])
    assert.deepEqual(b.axes.yaxis_left.getDomain(), [0, 100])
    open()
    await done
    assert.deepEqual(a.axes.xaxis_bottom.getDomain(), [0, 100])
    assert.deepEqual(a.axes.yaxis_left.getDomain(), [0, 100])
  })

  it('a linked zoom that arrives while a plot is updating is kept when it finishes', async () => {
    const { open, done } = await holdUpdate(a)
    b.axes.xaxis_bottom.setDomain([20, 60])
    open()
    await done
    assert.deepEqual(a.axes.xaxis_bottom.getDomain(), [20, 60])
    assert.deepEqual(a.axes.yaxis_left.getDomain(), [0, 100])
  })

  it('_isReady() is false while an update is in flight and true once it finishes', async () => {
    assert.isTrue(a._isReady())
    const { open, done } = await holdUpdate(a)
    assert.isFalse(a._isReady())
    open()
    await done
    assert.isTrue(a._isReady())
  })

  it('a wheel after the update finishes zooms the linked axes', async () => {
    const { open, done } = await holdUpdate(a)
    open()
    await done
    wheel(a)
    const [lo, hi] = b.axes.xaxis_bottom.getDomain()
    assert.isAbove(lo, 0)
    assert.isBelow(hi, 100)
  })
})
