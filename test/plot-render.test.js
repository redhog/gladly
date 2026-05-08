import { assert } from '@esm-bundle/chai'
import { Plot } from '../src/index.js'

const WIDTH = 200
const HEIGHT = 200

function makeContainer() {
  const el = document.createElement('div')
  el.style.width = `${WIDTH}px`
  el.style.height = `${HEIGHT}px`
  el.style.position = 'absolute'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  return el
}

function makeData(n = 200) {
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = i / (n - 1)
    y[i] = 0.5 + 0.4 * Math.sin(i / n * Math.PI * 2)
  }
  return { x, y }
}

// Waits for the next completed render pass and reads pixels from inside the
// render callback — the only safe window before the drawing buffer is swapped.
function readPixelsAfterRender(plot) {
  const canvas = plot.canvas
  const gl = plot.regl._gl
  return new Promise(resolve => {
    function onRender() {
      plot._renderCallbacks.delete(onRender)
      const buf = new Uint8Array(canvas.width * canvas.height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      resolve(buf)
    }
    plot._renderCallbacks.add(onRender)
    plot.scheduleRender()
  })
}

describe('Plot', () => {
  let container, plot

  beforeEach(() => {
    container = makeContainer()
    plot = new Plot(container)
  })

  afterEach(() => {
    plot.destroy()
    document.body.removeChild(container)
  })

  it('resolves update() without throwing', async () => {
    await plot.update({
      data: { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
  })

  it('creates a canvas element inside the container', async () => {
    await plot.update({
      data: { input: makeData() },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    assert.isNotNull(plot.canvas, 'canvas should be set on plot')
    assert.isAbove(plot.canvas.width, 0)
    assert.isAbove(plot.canvas.height, 0)
  })

  it('renders points — some pixels differ from the white background', async () => {
    await plot.update({
      data: { input: makeData(500) },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })

    // Read pixels from inside the render callback to guarantee the drawing
    // buffer has content before it is swapped by the compositor.
    const pixels = await readPixelsAfterRender(plot)

    // Background clears to white (255,255,255). At least one pixel should be
    // non-white because 500 points spanning the full range hit some pixels.
    let nonWhiteCount = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) nonWhiteCount++
    }
    assert.isAbove(nonWhiteCount, 0, 'Expected non-white pixels from rendered points')
  })

  it('update() twice with different data does not throw', async () => {
    await plot.update({
      data: { input: makeData(100) },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
    await plot.update({
      data: { input: makeData(200) },
      config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    })
  })
})
