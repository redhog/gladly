/**
 * Parallel shader compilation helpers.
 *
 * enqueueRegl(regl, config) — drop-in for regl(config) that defers compilation.
 *   Returns a callable handle backed by a null command until compileEnqueuedShaders()
 *   is called. State is stored on the regl object itself so no separate instance
 *   is needed.
 *
 * compileEnqueuedShaders(regl) — compiles all enqueued programs in parallel:
 *   1. Kicks off raw GL compilation for every queued program without checking
 *      status, so the GPU driver can pipeline them concurrently.
 *   2. Forces completion by checking LINK_STATUS on each (blocks only on
 *      stragglers; the rest are already done).
 *   3. Discards the raw programs — they exist only to warm the driver's shader
 *      binary cache (e.g. ANGLE on Chrome/Edge, Mesa on Linux).
 *   4. Creates real regl commands (driver returns cached binaries immediately)
 *      and resolves all handles.
 */

export function enqueueRegl(regl, config) {
  if (!regl._shaderQueue) regl._shaderQueue = []

  let realCmd = null
  const handle = (props) => realCmd(props)
  handle._config = config
  handle._resolve = (cmd) => { realCmd = cmd }
  regl._shaderQueue.push(handle)
  return handle
}

export function compileEnqueuedShaders(regl) {
  const queue = regl._shaderQueue ?? []
  regl._shaderQueue = null

  if (queue.length === 0) return

  const gl = regl._gl

  // Phase 1: start all compilations without checking status
  const precompiled = queue.map(({ _config: { vert, frag } }) => {
    const vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vs, vert)
    gl.compileShader(vs)

    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, frag)
    gl.compileShader(fs)

    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)

    return { prog, vs, fs }
  })

  // Phase 2: wait for all (they've been compiling in parallel)
  for (const { prog, vs, fs } of precompiled) {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[gladly] Shader pre-compilation failed; regl will report the detailed error')
    }
    gl.detachShader(prog, vs)
    gl.detachShader(prog, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    gl.deleteProgram(prog)
  }

  // Phase 3: create real regl commands (driver binary cache hit)
  for (const handle of queue) {
    handle._resolve(regl(handle._config))
  }
}
