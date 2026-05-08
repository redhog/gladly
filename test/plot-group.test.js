import { assert } from '@esm-bundle/chai'
import { Plot, PlotGroup } from '../src/index.js'

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

const PLOT_CONFIGS = {
  plotA: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
  plotB: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
}

describe('PlotGroup', () => {
  let cA, cB, plotA, plotB, group

  beforeEach(() => {
    cA = makeContainer(); cB = makeContainer()
    plotA = new Plot(cA);  plotB = new Plot(cB)
    group = null
  })

  afterEach(() => {
    group?.destroy()
    plotA.destroy(); plotB.destroy()
    document.body.removeChild(cA); document.body.removeChild(cB)
  })

  // ─── update() ───────────────────────────────────────────────────────────────

  it('update() provides the same normalized DataGroup instance to all member plots', async () => {
    group = new PlotGroup({ plotA, plotB })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    assert.strictEqual(plotA._rawData, plotB._rawData)
  })

  it('plots not mentioned in plots:{} keep their current config after update()', async () => {
    group = new PlotGroup({ plotA, plotB })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    const configBefore = plotB.currentConfig
    // Update only plotA
    await group.update({ plots: { plotA: PLOT_CONFIGS.plotA } })
    assert.deepEqual(plotB.currentConfig, configBefore)
  })

  // ─── autoLink ───────────────────────────────────────────────────────────────

  it('autoLink: true — axes with matching QK are linked after update()', async () => {
    group = new PlotGroup({ plotA, plotB }, { autoLink: true })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    // Both xaxis_bottom share QK 'input.x' → link created
    plotA.axes.xaxis_bottom.setDomain([0.1, 0.9])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), [0.1, 0.9])
  })

  it('autoLink propagates domain changes from B to A', async () => {
    group = new PlotGroup({ plotA, plotB }, { autoLink: true })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    plotB.axes.xaxis_bottom.setDomain([0.2, 0.8])
    assert.deepEqual(plotA.axes.xaxis_bottom.getDomain(), [0.2, 0.8])
  })

  it('autoLink: false — axes are independent by default', async () => {
    group = new PlotGroup({ plotA, plotB }, { autoLink: false })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    const domainBBefore = plotB.axes.xaxis_bottom.getDomain()
    plotA.axes.xaxis_bottom.setDomain([0.3, 0.7])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), domainBBefore)
  })

  // ─── destroy() ──────────────────────────────────────────────────────────────

  it('destroy() removes auto-links so domains no longer propagate', async () => {
    group = new PlotGroup({ plotA, plotB }, { autoLink: true })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    const domainBBefore = plotB.axes.xaxis_bottom.getDomain()
    group.destroy()
    group = null
    plotA.axes.xaxis_bottom.setDomain([0.05, 0.15])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), domainBBefore)
  })

  // ─── add() / remove() ───────────────────────────────────────────────────────

  it('add() integrates a new plot into auto-linking', async () => {
    const cC = makeContainer()
    const plotC = new Plot(cC)
    try {
      group = new PlotGroup({ plotA }, { autoLink: true })
      await group.update({ data: { input: makeData() }, plots: { plotA: PLOT_CONFIGS.plotA } })

      group.add('plotC', plotC)
      // Give plotC the same data and config, then trigger a group update so autoLink reconciles.
      await plotC.update({
        data:   plotA._rawData,
        config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
      })
      await group.update({})   // reconcile auto-links with the new QK in place

      plotA.axes.xaxis_bottom.setDomain([0.3, 0.7])
      assert.deepEqual(plotC.axes.xaxis_bottom.getDomain(), [0.3, 0.7])
    } finally {
      plotC.destroy()
      document.body.removeChild(cC)
    }
  })

  it('remove() tears down links to the removed plot', async () => {
    group = new PlotGroup({ plotA, plotB }, { autoLink: true })
    await group.update({ data: { input: makeData() }, plots: PLOT_CONFIGS })
    const domainBBefore = plotB.axes.xaxis_bottom.getDomain()
    group.remove('plotB')
    plotA.axes.xaxis_bottom.setDomain([0.05, 0.15])
    assert.deepEqual(plotB.axes.xaxis_bottom.getDomain(), domainBBefore)
  })

  it('remove() on an unknown name is a no-op', () => {
    group = new PlotGroup({ plotA, plotB })
    assert.doesNotThrow(() => group.remove('doesNotExist'))
  })
})
