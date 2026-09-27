import reglInit from "regl"

export function initRegl(canvas) {
  const gl = canvas.getContext('webgl2', { desynchronized: true })
  if (!gl) throw new Error('WebGL 2.0 is required but not supported')

  const origGetExtension = gl.getExtension.bind(gl)
  gl.getExtension = (name) => {
    const lname = name.toLowerCase()
    const wgl2CoreExts = ['oes_texture_float', 'oes_texture_float_linear']
    if (wgl2CoreExts.includes(lname)) return origGetExtension(name) ?? {}
    if (lname === 'angle_instanced_arrays') {
      return origGetExtension(name) ?? {
        vertexAttribDivisorANGLE: gl.vertexAttribDivisor.bind(gl),
        drawArraysInstancedANGLE: gl.drawArraysInstanced.bind(gl),
        drawElementsInstancedANGLE: gl.drawElementsInstanced.bind(gl),
        VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88FE
      }
    }
    return origGetExtension(name)
  }

  const GL_RGBA = 0x1908, GL_FLOAT = 0x1406, GL_RGBA32F = 0x8814
  const origTexImage2D = gl.texImage2D.bind(gl)
  gl.texImage2D = function (...args) {
    if (args.length >= 8 && args[2] === GL_RGBA && args[7] === GL_FLOAT) {
      args = [...args]
      args[2] = GL_RGBA32F
    }
    return origTexImage2D(...args)
  }

  // Workaround for a Mesa/Linux driver bug: calling framebufferTexture2D with a
  // depth/stencil attachment point and null texture on an FBO that has a float color
  // attachment causes GL_FRAMEBUFFER_UNSUPPORTED. regl always null-detaches all
  // depth/stencil slots before setting them as a cleanup step, which triggers the bug.
  // These null calls are always no-ops on freshly created FBOs, so skipping them is safe.
  const GL_DEPTH_ATTACHMENT = 0x8D00, GL_STENCIL_ATTACHMENT = 0x8D20, GL_DEPTH_STENCIL_ATTACHMENT = 0x821A
  const origFramebufferTexture2D = gl.framebufferTexture2D.bind(gl)
  gl.framebufferTexture2D = function (target, attachment, texTarget, texture, level) {
    if (texture === null && (attachment === GL_DEPTH_ATTACHMENT ||
                             attachment === GL_STENCIL_ATTACHMENT ||
                             attachment === GL_DEPTH_STENCIL_ATTACHMENT)) return
    return origFramebufferTexture2D(target, attachment, texTarget, texture, level)
  }

  return reglInit({
    gl,
    extensions: ['OES_texture_float', 'EXT_color_buffer_float', 'ANGLE_instanced_arrays'],
    optionalExtensions: ['OES_texture_float_linear'],
  })
}
