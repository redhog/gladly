import { assert } from '@esm-bundle/chai'
import { Plot, linkAxes } from '../src/index.js'

const WIDTH = 200, HEIGHT = 200

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

const basicUpdate = (d) => ({
  data:   { input: d },
  config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
})

// ─── Axis interface ────────────────────────────────────────────────────────────

describe('Axis', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('getDomain() returns null before any update()', () => {
    assert.isNull(plot.axes.xaxis_bottom.getDomain())
  })

  it('quantityKind is null before any update()', () => {
    assert.isNull(plot.axes.xaxis_bottom.quantityKind)
  })

  it('axes proxy returns the same Axis instance on repeated access', () => {
    assert.strictEqual(plot.axes.xaxis_bottom, plot.axes.xaxis_bottom)
  })

  it('Axis instance is stable across update() calls', async () => {
    const axisRef = plot.axes.xaxis_bottom
    await plot.update(basicUpdate(makeData()))
    assert.strictEqual(plot.axes.xaxis_bottom, axisRef)
  })

  it('getDomain() returns a finite [min, max] pair after update()', async () => {
    await plot.update(basicUpdate(makeData()))
    const domain = plot.axes.xaxis_bottom.getDomain()
    assert.isArray(domain)
    assert.equal(domain.length, 2)
    assert.isFinite(domain[0])
    assert.isFinite(domain[1])
    assert.isBelow(domain[0], domain[1])
  })

  it('setDomain() updates getDomain()', async () => {
    await plot.update(basicUpdate(makeData()))
    plot.axes.xaxis_bottom.setDomain([10, 20])
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [10, 20])
  })

  it('subscribe() fires when setDomain() is called', async () => {
    await plot.update(basicUpdate(makeData()))
    const received = []
    plot.axes.xaxis_bottom.subscribe((d) => received.push(d))
    plot.axes.xaxis_bottom.setDomain([5, 15])
    assert.deepEqual(received, [[5, 15]])
  })

  it('multiple subscribe() callbacks all fire', async () => {
    await plot.update(basicUpdate(makeData()))
    const log = []
    plot.axes.xaxis_bottom.subscribe((d) => log.push('A'))
    plot.axes.xaxis_bottom.subscribe((d) => log.push('B'))
    plot.axes.xaxis_bottom.setDomain([1, 2])
    assert.deepEqual(log.sort(), ['A', 'B'])
  })

  it('unsubscribe() prevents the callback from firing', async () => {
    await plot.update(basicUpdate(makeData()))
    const received = []
    const cb = (d) => received.push(d)
    const axis = plot.axes.xaxis_bottom
    axis.subscribe(cb)
    axis.unsubscribe(cb)
    axis.setDomain([5, 15])
    assert.isEmpty(received)
  })
})

// ─── linkAxes ─────────────────────────────────────────────────────────────────

describe('linkAxes', () => {
  let cA, cB, plotA, plotB

  beforeEach(() => {
    cA = makeContainer(); cB = makeContainer()
    plotA = new Plot(cA); plotB = new Plot(cB)
  })

  afterEach(() => {
    plotA.destroy(); plotB.destroy()
    document.body.removeChild(cA); document.body.removeChild(cB)
  })

  async function initBoth() {
    await Promise.all([plotA.update(basicUpdate(makeData())), plotB.update(basicUpdate(makeData()))])
  }

  it('propagates setDomain from A to B', async () => {
    await initBoth()
    const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)
    plotA.axes.xaxis_bottom.setDomain([0.2, 0.8])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), [0.2, 0.8])
    link.unlink()
  })

  it('propagates setDomain from B to A', async () => {
    await initBoth()
    const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)
    plotB.axes.xaxis_bottom.setDomain([0.1, 0.5])
    assert.deepEqual(plotA.axes.xaxis_bottom.getDomain(), [0.1, 0.5])
    link.unlink()
  })

  it('unlink() stops domain propagation', async () => {
    await initBoth()
    const domainBBefore = plotB.axes.xaxis_bottom.getDomain()
    const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)
    link.unlink()
    plotA.axes.xaxis_bottom.setDomain([0.3, 0.7])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), domainBBefore)
  })

  it('does not cause infinite recursion with bidirectional links', async () => {
    await initBoth()
    const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)
    // Re-entrancy guard should prevent stack overflow
    assert.doesNotThrow(() => plotA.axes.xaxis_bottom.setDomain([0.4, 0.6]))
    link.unlink()
  })

  it('throws when linking axes with incompatible quantity kinds', async () => {
    // plotA: QK = 'input.x', plotC: QK = 'run.x'
    const cC = makeContainer()
    const plotC = new Plot(cC)
    try {
      await plotA.update(basicUpdate(makeData()))
      await plotC.update({
        data:   { run: makeData() },
        config: { layers: [{ points: { xData: 'run.x', yData: 'run.y' } }] },
      })
      assert.throws(
        () => linkAxes(plotA.axes.xaxis_bottom, plotC.axes.xaxis_bottom),
        /incompatible/i
      )
    } finally {
      plotC.destroy()
      document.body.removeChild(cC)
    }
  })

  it('linkAxes before update() succeeds because both QKs are null', () => {
    assert.doesNotThrow(() => {
      const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)
      link.unlink()
    })
  })
})
