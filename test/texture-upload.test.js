import { assert } from '@esm-bundle/chai'
import reglInit from 'regl'
import { uploadToTexture } from '../src/data/ColumnData.js'

// Initialise a WebGL2 regl context matching GlBase's setup.
// Applies the same getExtension patch so regl accepts OES_texture_float
// (which is WebGL2 core but not always returned by name in headless Chrome).
function createRegl() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  document.body.appendChild(canvas)

  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL2 not available')

  const orig = gl.getExtension.bind(gl)
  const wgl2Core = ['oes_texture_float', 'oes_texture_float_linear']
  gl.getExtension = name => {
    const lname = name.toLowerCase()
    if (wgl2Core.includes(lname)) return orig(name) ?? {}
    if (lname === 'angle_instanced_arrays') {
      return orig(name) ?? {
        vertexAttribDivisorANGLE: gl.vertexAttribDivisor.bind(gl),
        drawArraysInstancedANGLE: gl.drawArraysInstanced.bind(gl),
        drawElementsInstancedANGLE: gl.drawElementsInstanced.bind(gl),
        VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88FE,
      }
    }
    return orig(name)
  }

  // Promote RGBA+FLOAT internal format to RGBA32F (required for float FBO readback).
  const GL_RGBA = 0x1908, GL_FLOAT = 0x1406, GL_RGBA32F = 0x8814
  const origTex = gl.texImage2D.bind(gl)
  gl.texImage2D = function (...args) {
    if (args.length >= 8 && args[2] === GL_RGBA && args[7] === GL_FLOAT) {
      args = [...args]; args[2] = GL_RGBA32F
    }
    return origTex(...args)
  }

  const regl = reglInit({
    gl,
    extensions: ['OES_texture_float', 'EXT_color_buffer_float', 'ANGLE_instanced_arrays'],
    optionalExtensions: ['OES_texture_float_linear'],
  })

  return { regl, canvas }
}

describe('uploadToTexture', () => {
  let regl, canvas

  before(() => {
    ({ regl, canvas } = createRegl())
  })

  after(() => {
    regl.destroy()
    document.body.removeChild(canvas)
  })

  it('creates a texture with correct _dataLength', () => {
    const arr = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8])
    const tex = uploadToTexture(regl, arr)
    assert.equal(tex._dataLength, 8)
  })

  it('packs 4 values per texel — 8 values fit in 2 texels', () => {
    const arr = new Float32Array(8)
    const tex = uploadToTexture(regl, arr)
    assert.equal(tex.width * tex.height, 2)
  })

  it('rounds up to ceil(N/4) texels for non-multiple-of-4 lengths', () => {
    const arr = new Float32Array(5)
    const tex = uploadToTexture(regl, arr)
    assert.equal(tex.width * tex.height, 2)  // ceil(5/4) = 2
  })

  it('reads back correct float values via FBO readPixels', function () {
    const arr = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])
    const tex = uploadToTexture(regl, arr)

    let fbo
    try {
      fbo = regl.framebuffer({ color: tex, depth: false, stencil: false })
    } catch (e) {
      // Float FBO not supported in this environment (e.g. SwiftShader headless Chrome).
      // The upload is still verified by the metadata tests above.
      this.skip()
      return
    }

    let pixels
    regl({ framebuffer: fbo })(() => {
      pixels = regl.read({ data: new Float32Array(tex.width * tex.height * 4) })
    })

    for (let i = 0; i < arr.length; i++) {
      assert.closeTo(pixels[i], arr[i], 0.001, `mismatch at index ${i}`)
    }
  })
})
