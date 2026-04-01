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
  // Guard: silently skip if called before compilation resolves the handle
  const handle = (props) => realCmd && realCmd(props)
  handle._config = config
  handle._resolve = (cmd) => { realCmd = cmd }
  regl._shaderQueue.push(handle)
  return handle
}

const yieldToEventLoop = () => new Promise(r => setTimeout(r, 0))

export async function compileEnqueuedShaders(regl) {
  const queue = regl._shaderQueue ?? []
  regl._shaderQueue = null

  if (queue.length === 0) return

  const gl = regl._gl

  // Phase 1: start all compilations without checking status (no yield — must be atomic
  // so all shaders are submitted to the GPU before any status check)
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

  // Phase 2: check status and clean up, yielding between programs so the browser
  // stays responsive. Each getProgramParameter() may block briefly (GPU sync point),
  // but TDR is not triggered by compile time — only by GPU execution time.
  // Unresolved handles are guarded (no-op) so renders that fire during yields are safe.
  const failed = new Set()
  for (let i = 0; i < precompiled.length; i++) {
    const { prog, vs, fs } = precompiled[i]
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // Capture error logs NOW, before context loss makes them null.
      const vsLog = gl.getShaderInfoLog(vs) ?? '(log unavailable — context may be lost)'
      const fsLog = gl.getShaderInfoLog(fs) ?? '(log unavailable — context may be lost)'
      const progLog = gl.getProgramInfoLog(prog) ?? '(log unavailable — context may be lost)'
      console.error(
        '[gladly] Shader pre-compilation failed (will skip creating regl command).\n' +
        `  vertex log:  ${vsLog}\n` +
        `  fragment log: ${fsLog}\n` +
        `  program log: ${progLog}`
      )
      failed.add(i)
    }
    gl.detachShader(prog, vs)
    gl.detachShader(prog, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    gl.deleteProgram(prog)
    await yieldToEventLoop()
  }

  // Phase 3: create real regl commands (driver binary cache hit), yielding between
  // each so a batch of many shaders doesn't monopolise the main thread.
  // Skip handles whose pre-compilation failed — regl would crash on a lost context.
  for (let i = 0; i < queue.length; i++) {
    if (!failed.has(i)) {
      queue[i]._resolve(regl(queue[i]._config))
    }
    await yieldToEventLoop()
  }
}
