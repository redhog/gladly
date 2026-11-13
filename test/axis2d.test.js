import { assert } from '@esm-bundle/chai'
import { Plot, Axis2d, registerAxisQuantityKind } from '../src/index.js'

// x-role = vData, y-role = vData2 (see ScatterShared: colorAxes {'':vQK,'2':vQK2}).
const QK_X = 'reflectance_au'
const QK_Y = 'temperature_K'
const KEY   = `${QK_X}__${QK_Y}`
const TWOD  = 'bilinear4corner'   // pre-registered 2D colorscale (BivariateColorscales)

registerAxisQuantityKind('distance_m',   { label: 'Distance (m)', scale: 'linear' })
registerAxisQuantityKind('voltage_V',    { label: 'Voltage (V)',  scale: 'linear' })
registerAxisQuantityKind(QK_X, { label: 'Reflectance', scale: 'linear', colorscale: 'magma' })
registerAxisQuantityKind(QK_Y, { label: 'Temp (K)',    scale: 'linear', colorscale: 'coolwarm' })

const WIDTH = 200, HEIGHT = 200

function makeContainer() {
  const el = document.createElement('div')
  el.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:absolute;left:-9999px`
  document.body.appendChild(el)
  return el
}

function makeData(n = 64) {
  const x = new Float32Array(n), y = new Float32Array(n)
  const v = new Float32Array(n), w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    x[i] = t; y[i] = t; v[i] = t; w[i] = 1 - t
  }
  return {
    input: {
      x: { data: x, quantity_kind: 'distance_m' },
      y: { data: y, quantity_kind: 'voltage_V' },
      v: { data: v, quantity_kind: QK_X },
      w: { data: w, quantity_kind: QK_Y },
    },
  }
}

// Bivariate points layer (vData + vData2) → the layer fuses the QK_X/QK_Y pair.
function bivariateConfig(colorbars = []) {
  return {
    layers: [{
      points: {
        xData: 'input.x', yData: 'input.y',
        vData: 'input.v', vData2: 'input.w',
        xAxis: 'xaxis_bottom', yAxis: 'yaxis_left',
      },
    }],
    axes: {
      xaxis_bottom: { min: 0, max: 1 },
      yaxis_left:   { min: 0, max: 1 },
      [QK_X]: { min: 0, max: 1, colorbar: 'none' },
      [QK_Y]: { min: 0, max: 1, colorbar: 'none' },
    },
    colorbars,
  }
}

const twoDFloatTag = `colorbar2d:${QK_X}:${QK_Y}`

describe('Axis2d — static helpers', () => {
  it('makeKey / splitKey round-trip an ordered pair', () => {
    assert.equal(Axis2d.makeKey(QK_X, QK_Y), KEY)
    assert.deepEqual(Axis2d.splitKey(KEY), [QK_X, QK_Y])
  })

  it('splitKey recovers x and y roles (x never contains the separator)', () => {
    const [x, y] = Axis2d.splitKey(KEY)
    assert.equal(x, QK_X)
    assert.equal(y, QK_Y)
  })

  it('registerAxisQuantityKind rejects a name containing the "__" separator', () => {
    assert.throws(() => registerAxisQuantityKind('foo__bar', { scale: 'linear' }), /__/)
  })

  it('schema() equals Plot.schema().properties.colorbars.items and includes enabled/colorbar', () => {
    const items = Plot.schema().properties.colorbars.items
    assert.deepEqual(Axis2d.schema(), items)
    assert.property(Axis2d.schema().properties, 'enabled')
    assert.property(Axis2d.schema().properties, 'colorbar')
    assert.equal(Axis2d.schema().properties.enabled.default, true)
    assert.equal(Axis2d.schema().properties.colorbar.default, true)
  })
})

describe('plot.axis2d', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('enumerates exactly the layer-defined 2D pairs', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    assert.deepEqual(Object.keys(plot.axis2d), [KEY])
    assert.isTrue(KEY in plot.axis2d)
  })

  it('a pair with no backing layer is absent from enumeration but still accessible and inert', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    assert.isFalse('voltage_V__distance_m' in plot.axis2d)
    const handle = plot.axis2d['voltage_V__distance_m']
    assert.instanceOf(handle, Axis2d)
    assert.deepEqual(handle.getConfig(), {})
  })

  it('returns a stable (cached) handle across accesses', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    assert.strictEqual(plot.axis2d[KEY], plot.axis2d[KEY])
  })

  it('the __ separator permits dot access equivalent to the bracket form', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    assert.strictEqual(plot.axis2d.reflectance_au__temperature_K, plot.axis2d[KEY])
  })

  it('splits the string key back into x/y roles on the handle', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    const a = plot.axis2d[KEY]
    assert.equal(a.xAxis, QK_X)
    assert.equal(a.yAxis, QK_Y)
  })
})

describe('Axis2d.getConfig() / setConfig()', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })
  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('getConfig() deep-equals the pair entry inside plot.getConfig().colorbars', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD }]),
    })
    const entry = plot.getConfig().colorbars.find(e => e.xAxis === QK_X && e.yAxis === QK_Y)
    assert.deepEqual(plot.axis2d[KEY].getConfig(), entry)
  })

  it('getConfig() is {} for a layer-defined pair with no entry yet', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    assert.deepEqual(plot.axis2d[KEY].getConfig(), {})
  })

  it('setConfig() find-or-creates exactly one entry (no duplicate when called twice)', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    await plot.axis2d[KEY].setConfig({ colorscale: TWOD })
    await plot.axis2d[KEY].setConfig({ colorscale: TWOD })
    const matching = plot.getConfig().colorbars.filter(e => e.xAxis === QK_X && e.yAxis === QK_Y)
    assert.equal(matching.length, 1)
    assert.equal(matching[0].colorscale, TWOD)
  })

  it('setConfig() entry matches the pair split from its string key (x/y order preserved)', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    await plot.axis2d[KEY].setConfig({ colorscale: TWOD })
    const entry = plot.getConfig().colorbars.find(e => e.colorscale === TWOD)
    assert.equal(entry.xAxis, QK_X)
    assert.equal(entry.yAxis, QK_Y)
  })
})

describe('enabled gate — 2D colouring vs per-axis colourscales', () => {
  let container, plot
  const idx = qk => plot.axisRegistry.getColorscaleIndex(qk)

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })
  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('enabled:true with a shared 2D colorscale → both members share one negative (2D) index', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD }]),
    })
    // cs_a == cs_b < 0 is exactly the condition map_color_s_2d uses for the 2D branch.
    assert.isBelow(idx(QK_X), 0)
    assert.equal(idx(QK_X), idx(QK_Y))
  })

  it('enabled:false → members keep their own (distinct, 1D) colorscales', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, enabled: false }]),
    })
    assert.isAtLeast(idx(QK_X), 0)
    assert.isAtLeast(idx(QK_Y), 0)
    assert.notEqual(idx(QK_X), idx(QK_Y))
  })

  it('no entry and enabled:false produce the identical member colorscale indices', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    const noEntry = [idx(QK_X), idx(QK_Y)]
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, enabled: false }]),
    })
    assert.deepEqual([idx(QK_X), idx(QK_Y)], noEntry)
  })
})

describe('colorbar gate — float widget presence', () => {
  let container, plot
  const idx = qk => plot.axisRegistry.getColorscaleIndex(qk)

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })
  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('colorbar:true (default) → colorbar2d float present', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD }]),
    })
    assert.isTrue(plot._floats.has(twoDFloatTag))
  })

  it('colorbar:false → no colorbar2d float', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, colorbar: false }]),
    })
    assert.isFalse(plot._floats.has(twoDFloatTag))
  })

  it('enabled:true, colorbar:false → 2D colouring with no visible colorbar', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, colorbar: false }]),
    })
    assert.isBelow(idx(QK_X), 0)
    assert.equal(idx(QK_X), idx(QK_Y))     // still the 2D branch
    assert.isFalse(plot._floats.has(twoDFloatTag))
  })

  it('toggling colorbar does not change the layer colourscale indices', async () => {
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, colorbar: true }]),
    })
    const withBar = [idx(QK_X), idx(QK_Y)]
    await plot.update({
      data: makeData(),
      config: bivariateConfig([{ xAxis: QK_X, yAxis: QK_Y, colorscale: TWOD, colorbar: false }]),
    })
    assert.deepEqual([idx(QK_X), idx(QK_Y)], withBar)
  })
})

describe('config round-trip of enabled / colorbar', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })
  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('setConfig persists enabled/colorbar through getConfig() and a fresh update()', async () => {
    await plot.update({ data: makeData(), config: bivariateConfig() })
    await plot.axis2d[KEY].setConfig({ colorscale: TWOD, enabled: true, colorbar: false })

    const cfg = plot.axis2d[KEY].getConfig()
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.colorbar, false)

    // Re-applying the whole config restores both keys.
    await plot.update({ data: makeData(), config: plot.getConfig() })
    const cfg2 = plot.axis2d[KEY].getConfig()
    assert.equal(cfg2.enabled, true)
    assert.equal(cfg2.colorbar, false)
  })
})
