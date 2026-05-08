import { assert } from '@esm-bundle/chai'
import { Plot, Colorbar, Filterbar } from '../src/index.js'

const WIDTH = 200, HEIGHT = 200
const MARGIN = { top: 60, right: 60, bottom: 60, left: 60 }
const PLOT_W = WIDTH  - MARGIN.left - MARGIN.right   // 80
const PLOT_H = HEIGHT - MARGIN.top  - MARGIN.bottom  // 80

function makeContainer(w = WIDTH, h = HEIGHT) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

function makeData(n = 100) {
  const x = new Float32Array(n), y = new Float32Array(n), v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i / (n - 1)
    y[i] = 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2)
    v[i] = i / (n - 1)
  }
  return { x, y, v }
}

// ─── Pan / zoom via axis.setDomain() ──────────────────────────────────────────
//
// Container: 200×200, margin 60 → plot area 80×80.
// With x domain [0, 100]:  D3 range [0, 80], so invert(40) = 50.
// With y domain [0, 100]:  D3 range [80, 0] (inverted), so top maps to 100, bottom to 0.

describe('Pan and zoom — axis.setDomain()', () => {
  let container, plot

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

  it('setDomain updates the value returned by getDomain()', () => {
    plot.axes.xaxis_bottom.setDomain([20, 80])
    assert.deepEqual(plot.axes.xaxis_bottom.getDomain(), [20, 80])
  })

  it('setDomain is reflected in getConfig().axes', () => {
    plot.axes.xaxis_bottom.setDomain([10, 90])
    const cfg = plot.getConfig()
    assert.closeTo(cfg.axes.xaxis_bottom.min, 10, 0.001)
    assert.closeTo(cfg.axes.xaxis_bottom.max, 90, 0.001)
  })

  it('zoom in — narrower domain maps the plot centre to the expected data value', () => {
    // Domain [0, 40]: centre of plot (plotX = 40) → invert(40) = 20
    plot.axes.xaxis_bottom.setDomain([0, 40])
    const coords = plot.lookup(MARGIN.left + PLOT_W / 2, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 20, 0.5)
  })

  it('zoom out — wider domain maps the plot centre to the expected data value', () => {
    // Domain [0, 200]: centre of plot (plotX = 40) → invert(40) = 100
    plot.axes.xaxis_bottom.setDomain([0, 200])
    const coords = plot.lookup(MARGIN.left + PLOT_W / 2, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 100, 0.5)
  })

  it('pan right — left edge of plot maps to the new domain minimum', () => {
    // Pan so domain = [50, 150]: left edge should now return 50
    plot.axes.xaxis_bottom.setDomain([50, 150])
    const coords = plot.lookup(MARGIN.left, HEIGHT / 2)
    assert.closeTo(coords.xaxis_bottom, 50, 0.5)
  })

  it('y-axis setDomain changes the top/bottom lookup mapping', () => {
    // Domain [200, 300] on y: top of plot should now return 300
    plot.axes.yaxis_left.setDomain([200, 300])
    const coords = plot.lookup(WIDTH / 2, MARGIN.top)
    assert.closeTo(coords.yaxis_left, 300, 0.5)
  })
})

// ─── Color axis ───────────────────────────────────────────────────────────────

describe('Color axis interactions', () => {
  const COLOR_QK = 'input.v'
  let container, plot

  beforeEach(async () => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
    await plot.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y', vData: 'input.v' } }],
        axes:   { [COLOR_QK]: { min: 0, max: 1 } },
      },
    })
    // The ResizeObserver fires a RAF that can interrupt the first _initialize via
    // an epoch bump. A second forceUpdate() runs after that RAF has already fired,
    // so it completes cleanly and ensures _setDomains() is called.
    await plot.forceUpdate()
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('color axis exists with its initial domain from config', () => {
    const domain = plot.axes[COLOR_QK].getDomain()
    assert.isArray(domain)
    assert.closeTo(domain[0], 0, 0.001)
    assert.closeTo(domain[1], 1, 0.001)
  })

  it('setDomain on color axis updates getDomain()', () => {
    plot.axes[COLOR_QK].setDomain([0.2, 0.8])
    const domain = plot.axes[COLOR_QK].getDomain()
    assert.closeTo(domain[0], 0.2, 0.001)
    assert.closeTo(domain[1], 0.8, 0.001)
  })

  it('setDomain on color axis is reflected in getConfig().axes', () => {
    plot.axes[COLOR_QK].setDomain([0.3, 0.7])
    const cfg = plot.getConfig()
    assert.closeTo(cfg.axes[COLOR_QK].min, 0.3, 0.001)
    assert.closeTo(cfg.axes[COLOR_QK].max, 0.7, 0.001)
  })

  it('subscribe on color axis fires when domain changes', () => {
    const received = []
    plot.axes[COLOR_QK].subscribe((d) => received.push(d))
    plot.axes[COLOR_QK].setDomain([0.1, 0.9])
    assert.deepEqual(received, [[0.1, 0.9]])
  })
})

// ─── Filter axis ──────────────────────────────────────────────────────────────

describe('Filter axis interactions', () => {
  const FILTER_QK = 'input.v'
  let container, plot

  beforeEach(async () => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
    await plot.update({
      data:   { input: makeData() },
      config: {
        // fData registers 'input.v' as a filter axis
        layers: [{ points: { xData: 'input.x', yData: 'input.y', fData: 'input.v' } }],
      },
    })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('filter axis is registered after update() with fData', () => {
    // getDomain returns [null, null] (open bounds) or null before any explicit set
    const domain = plot.axes[FILTER_QK].getDomain()
    assert.ok(domain === null || Array.isArray(domain))
  })

  it('setDomain on filter axis updates getDomain() with exact bounds', () => {
    plot.axes[FILTER_QK].setDomain([0.2, 0.8])
    const domain = plot.axes[FILTER_QK].getDomain()
    assert.isArray(domain)
    assert.closeTo(domain[0], 0.2, 0.001)
    assert.closeTo(domain[1], 0.8, 0.001)
  })

  it('setDomain on filter axis is reflected in getConfig().axes', () => {
    plot.axes[FILTER_QK].setDomain([0.1, 0.9])
    const cfg = plot.getConfig()
    assert.property(cfg.axes, FILTER_QK)
    assert.closeTo(cfg.axes[FILTER_QK].min, 0.1, 0.001)
    assert.closeTo(cfg.axes[FILTER_QK].max, 0.9, 0.001)
  })

  it('filter axis subscribe fires when domain changes', () => {
    const received = []
    plot.axes[FILTER_QK].subscribe((d) => received.push(d))
    plot.axes[FILTER_QK].setDomain([0.3, 0.7])
    assert.deepEqual(received, [[0.3, 0.7]])
  })
})

// ─── Colorbar pan / zoom ──────────────────────────────────────────────────────

describe('Colorbar pan/zoom', () => {
  const COLOR_QK = 'input.v'
  let cTarget, cBar, target, colorbar

  beforeEach(async () => {
    cTarget = makeContainer()
    cBar    = makeContainer(300, 80)
    target  = new Plot(cTarget, { margin: MARGIN })
    await target.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y', vData: 'input.v' } }],
        axes:   { [COLOR_QK]: { min: 0, max: 1 } },
      },
    })
    colorbar = new Colorbar(cBar, target, COLOR_QK, { orientation: 'horizontal' })
  })

  afterEach(() => {
    colorbar.destroy()
    target.destroy()
    document.body.removeChild(cTarget)
    document.body.removeChild(cBar)
  })

  it('Colorbar constructor succeeds without throwing', () => {
    assert.instanceOf(colorbar, Colorbar)
  })

  it('colorbar is linked to the target — its axes proxy is accessible', () => {
    // The Axis object is always available even before async init completes.
    assert.ok(colorbar.axes.xaxis_bottom)
  })

  it('setting colorbar spatial axis domain propagates to target color axis', () => {
    // The linkAxes call in Colorbar constructor wires cb1: colorbarAxis → targetColorAxis
    colorbar.axes.xaxis_bottom.setDomain([0.3, 0.7])
    const domain = target.axes[COLOR_QK].getDomain()
    assert.isArray(domain)
    assert.closeTo(domain[0], 0.3, 0.001)
    assert.closeTo(domain[1], 0.7, 0.001)
  })
})

// ─── Filterbar pan / zoom ─────────────────────────────────────────────────────

describe('Filterbar pan/zoom', () => {
  const FILTER_QK = 'input.v'
  let cTarget, cBar, target, filterbar

  beforeEach(async () => {
    cTarget = makeContainer()
    cBar    = makeContainer(300, 80)
    target  = new Plot(cTarget, { margin: MARGIN })
    await target.update({
      data:   { input: makeData() },
      config: {
        layers: [{ points: { xData: 'input.x', yData: 'input.y', fData: 'input.v' } }],
        axes:   { [FILTER_QK]: { min: 0, max: 1 } },
      },
    })
    filterbar = new Filterbar(cBar, target, FILTER_QK, { orientation: 'horizontal' })
  })

  afterEach(() => {
    filterbar.destroy()
    target.destroy()
    document.body.removeChild(cTarget)
    document.body.removeChild(cBar)
  })

  it('Filterbar constructor succeeds without throwing', () => {
    assert.instanceOf(filterbar, Filterbar)
  })

  it('filterbar is linked to the target — its axes proxy is accessible', () => {
    assert.ok(filterbar.axes.xaxis_bottom)
  })

  it('setting filterbar spatial axis domain propagates to target filter axis', () => {
    // The linkAxes call in Filterbar constructor wires cb1: filterbarAxis → targetFilterAxis
    filterbar.axes.xaxis_bottom.setDomain([0.2, 0.8])
    const domain = target.axes[FILTER_QK].getDomain()
    assert.isArray(domain)
    assert.closeTo(domain[0], 0.2, 0.001)
    assert.closeTo(domain[1], 0.8, 0.001)
  })
})
