import { assert } from '@esm-bundle/chai'
import { Plot, LayerType, registerLayerType, getMasterCanvas } from '../src/index.js'

const WIDTH = 200
const HEIGHT = 200
const MARGIN = { top: 10, right: 10, bottom: 10, left: 10 }

// Fills the whole [0,1] x [0,1] data square in red, as a curtain or an image layer does.
registerLayerType('test_fill', new LayerType({
  name: 'test_fill',
  xAxis: 'xaxis_bottom', xAxisQuantityKind: 'test_x',
  yAxis: 'yaxis_left',   yAxisQuantityKind: 'test_y',
  vert: `#version 300 es
precision mediump float;
in float x;
in float y;
void main() { gl_Position = plot_pos(vec2(x, y)); }`,
  frag: `#version 300 es
precision mediump float;
void main() { fragColor = gladly_apply_color(vec4(1.0, 0.0, 0.0, 1.0)); }`,
  schema: () => ({ type: 'object', properties: {} }),
  createLayer: () => [{
    attributes: { x: new Float32Array([0, 1, 0, 1]), y: new Float32Array([0, 0, 1, 1]) },
    uniforms: {},
    domains: { test_x: [0, 1], test_y: [0, 1] },
    primitive: 'triangle strip',
    vertexCount: 4,
  }],
}))

// A horizontal line across the middle of the fill. zb has no quantity kind of its own.
function makeData() {
  return {
    input: {
      data: {
        x:  new Float32Array([0, 1]),
        y:  new Float32Array([0.5, 0.5]),
        zb: new Float32Array([0.2, 0.2]),
      },
      quantity_kinds: { x: 'test_x', y: 'test_y' },
    },
  }
}

function makeContainer() {
  const el = document.createElement('div')
  el.style.width = `${WIDTH}px`
  el.style.height = `${HEIGHT}px`
  el.style.position = 'absolute'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  return el
}

// Draws the plot into the shared offscreen as MasterCanvas does and reads it back before
// the bitmap is handed on. MasterCanvas itself skips these off-screen test containers.
async function drawPixels(plot) {
  await plot._prepareRender()
  plot._updateDimensions(plot._canvas.getBoundingClientRect())
  const offscreen = getMasterCanvas()._offscreen
  offscreen.width = plot.width
  offscreen.height = plot.height
  plot.regl.poll()
  plot._drawSync()
  const gl = plot.regl._gl
  const pixels = new Uint8Array(plot.width * plot.height * 4)
  gl.readPixels(0, 0, plot.width, plot.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return pixels
}

// Counts pixels inside the plot area, within `band` rows of data y = 0.5, that match `test`.
function countAtMiddle(plot, pixels, test, band = 2) {
  const mid = Math.round(MARGIN.bottom + plot.plotHeight / 2)
  let n = 0
  for (let row = mid - band; row <= mid + band; row++) {
    for (let col = MARGIN.left + 2; col < plot.width - MARGIN.right - 2; col++) {
      const i = (row * plot.width + col) * 4
      if (test(pixels[i], pixels[i + 1], pixels[i + 2])) n++
    }
  }
  return n
}

const isRed = (r, g, b) => r > 200 && g < 30 && b < 30
// The black line is antialiased, so over the red fill it comes out dark red, not black.
const isLine = (r, g, b) => r < 200

describe('Plot layers', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container, { margin: MARGIN })
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('a 2D layer drawn after a filled layer shows on top of it', async () => {
    await plot.update({
      data: makeData(),
      config: { layers: [
        { test_fill: {} },
        { lines: { xData: 'input.x', yData: 'input.y' } },
      ] },
    })
    const pixels = await drawPixels(plot)
    assert.isAbove(countAtMiddle(plot, pixels, isRed, 20), 0, 'the fill draws')
    assert.isAbove(countAtMiddle(plot, pixels, isLine), plot.plotWidth / 2, 'the line draws over the fill')
  })

  it('a layer whose quantity kind clashes with its axis is skipped, the others still draw', async () => {
    const errors = []
    plot.on('error', e => errors.push(e.message))
    await plot.update({
      data: makeData(),
      config: { layers: [
        { test_fill: {} },
        { lines: { xData: 'input.x', yData: 'input.zb' } },
        { lines: { xData: 'input.x', yData: 'input.y' } },
      ] },
    })
    // The ResizeObserver may run update() again, reporting the same layer once per update.
    assert.isNotEmpty(errors)
    for (const message of errors) {
      assert.include(message, "Layer 'lines' (index 1) skipped")
      assert.include(message, "'yaxis_left' has quantity kind 'test_y'")
    }
    assert.deepEqual(plot.layers.map(l => l.configLayerIndex), [0, 2])
    assert.deepEqual(plot.axes.yaxis_left.getDomain(), [0, 1])
    const pixels = await drawPixels(plot)
    assert.isAbove(countAtMiddle(plot, pixels, isLine), plot.plotWidth / 2, 'the later line still draws')
  })
})
