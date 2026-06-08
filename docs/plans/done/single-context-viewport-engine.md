# Plan: Single-Context Viewport Engine

## Overview

Refactor Gladly to use a single shared WebGL context for all `Plot` instances. A fixed-position, full-viewport master canvas owns the regl context and the RAF loop; individual plots become lightweight placeholder `<div>` elements whose position and size are tracked via `getBoundingClientRect()`. Each render frame, visible plots are rendered in order using WebGL scissor/viewport to confine drawing to their on-screen region.

This enables:
- **Zero-copy cross-plot sharing**: `SelectionColumn` textures and named framebuffers are created once in the shared context and are directly bindable in any plot's draw calls — no GPU-to-GPU copy.
- **Correct hidden-tab behaviour**: off-screen, zero-size, and `display:none` plots return a zero-rect from `getBoundingClientRect()` and are silently skipped each frame at zero GPU cost.
- **Centralized resource lifecycle**: a ref-counted `ResourceRegistry` with a `FinalizationRegistry` safety net prevents GPU VRAM leaks.

`Float` widgets (`Colorbar`, `Filterbar`, `Colorbar2d`) extend `Plot` and inherit all changes automatically.

---

## Part 1: Extract `initRegl` utility

### Motivation

`GlBase._initRegl(canvas)` (`src/core/GlBase.js:22–56`) applies three WebGL 2.0 shims then constructs the regl instance. `MasterCanvas` needs to call the same logic on its own canvas without inheriting `GlBase`'s axis/selection proxy state.

### New file: `src/core/initRegl.js`

Move the shim + regl construction code verbatim. Export a single function:

```js
export function initRegl(canvas) {
  const gl = canvas.getContext('webgl2', { desynchronized: true })
  if (!gl) throw new Error('WebGL 2.0 is required but not supported')
  // ... three existing shims (OES_texture_float, ANGLE_instanced_arrays, texImage2D) ...
  return reglInit({
    gl,
    extensions: ['OES_texture_float', 'EXT_color_buffer_float', 'ANGLE_instanced_arrays'],
    optionalExtensions: ['OES_texture_float_linear'],
  })
}
```

### `GlBase._initRegl` becomes a one-liner

```js
_initRegl(canvas) {
  this.regl = initRegl(canvas)
}
```

---

## Part 2: `MasterCanvas`

### New file: `src/core/MasterCanvas.js`

#### Lazy singleton

```js
let _instance = null
export function getMasterCanvas() {
  if (!_instance) _instance = new MasterCanvas()
  return _instance
}
```

#### Construction

- Creates a `<canvas>` appended to `document.body`:
  ```css
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 0;
  ```
- Sets `canvas.width = window.innerWidth; canvas.height = window.innerHeight` (matching current per-plot convention: no explicit DPR scaling).
- Calls `initRegl(canvas)` to obtain `this.regl` — the **only** regl context in the application.
- Adds `window` listeners for `resize` and `window.matchMedia('screen')` change (DPR shifts when window moves between monitors) that:
  1. Update `canvas.width / canvas.height`.
  2. Schedule a redraw of all registered plots.

#### Plot registry

```
_plots: Set<Plot>       — all registered plots
_dirtyPlots: Set<Plot>  — plots scheduled for the next frame
_rafId: number | null
```

- `register(plot)` — adds to `_plots`.
- `unregister(plot)` — removes from both sets; cancels pending RAF if `_plots` is now empty.
- `schedulePlotRender(plot)` — adds to `_dirtyPlots`, calls `_scheduleRAF()`.

#### Coordinate mapping

```js
_plotScissor(rect) {
  return {
    x:      Math.round(rect.left),
    y:      Math.round(window.innerHeight - rect.bottom),  // WebGL uses bottom-left origin
    width:  Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  }
}

_isVisible(rect) {
  return (
    rect.width > 0 && rect.height > 0 &&
    rect.bottom > 0 && rect.top    < window.innerHeight &&
    rect.right  > 0 && rect.left   < window.innerWidth
  )
}
```

#### RAF loop

```js
_scheduleRAF() {
  if (this._rafId !== null) return
  this._rafId = requestAnimationFrame(t => this._tick(t))
}

async _tick(rafTime) {
  this._rafId = null
  const toRender = [...this._dirtyPlots]
  this._dirtyPlots.clear()

  // Phase 1 — async: refresh transforms and data columns for all dirty plots.
  // Done outside any scissor scope so tdrYield() calls don't interfere with draws.
  await Promise.all(toRender.map(p =>
    p._prepareRender().catch(e => console.error('[gladly] _prepareRender:', e))
  ))

  // Phase 2 — sync: draw each visible plot within its scissor region.
  for (const plot of toRender) {
    const rect = plot._placeholder.getBoundingClientRect()
    if (!this._isVisible(rect)) continue
    const box = this._plotScissor(rect)
    plot._updateDimensions(rect)
    this.regl({ scissor: { enable: true, box } })(() => {
      this.regl.clear({ color: [1, 1, 1, 1], depth: 1 })
      plot._drawSync(box)
    })
  }

  // Second RAF: gate new dirty marks until the compositor has had one GPU cycle,
  // matching the existing per-plot double-RAF pattern in scheduleRender().
  this._rafId = requestAnimationFrame(() => {
    this._rafId = null
    if (this._dirtyPlots.size > 0) this._scheduleRAF()
  })
}
```

#### Axis draw command singletons

`_axisLineCmd` and `_axisBillboardCmd` are stateless regl commands (all per-plot state arrives via uniforms). Currently each Plot creates its own copy in `_initialize()`. Move their construction to MasterCanvas:

```js
this.axisLineCmd      = buildAxisLineCmd(this.regl)
this.axisBillboardCmd = buildAxisBillboardCmd(this.regl)
```

Plots access them as `getMasterCanvas().axisLineCmd` instead of `this._axisLineCmd`. Remove the per-plot creation calls from `Plot._initialize()`.

---

## Part 3: `Plot.js` refactor

### Replace canvas with placeholder `<div>`

Remove (lines 207–212):
```js
this.canvas = document.createElement('canvas')
this.canvas.style.display = 'block'
this.canvas.style.position = 'absolute'
this.canvas.style.top  = '0'
this.canvas.style.left = '0'
container.appendChild(this.canvas)
```

Replace with:
```js
this._placeholder = document.createElement('div')
this._placeholder.style.cssText = 'display:block; position:absolute; top:0; left:0; width:100%; height:100%'
container.appendChild(this._placeholder)
```

### Use shared regl context

In the Plot constructor, after creating the placeholder:
```js
this.regl = getMasterCanvas().regl
getMasterCanvas().register(this)
```

Remove the `_initRegl()` call from `Plot._initialize()` (currently inherited from `GlBase`). `this.regl` is now set once at construction time, not per-`_initialize()`.

### `_applyUpdate()` — dimension handling

Remove:
```js
this.canvas.width  = Math.max(1, width)
this.canvas.height = Math.max(1, height)
```

`this.width` and `this.height` are still read from `this.container.clientWidth/Height` here (for the initial `_initialize()` call). `_updateDimensions()` below keeps them current during rendering.

### `_updateDimensions(rect)` — new method

Called by MasterCanvas immediately before `_drawSync()`:
```js
_updateDimensions(rect) {
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  if (w === this.width && h === this.height) return
  this.width      = w
  this.height     = h
  this.plotWidth  = Math.max(1, w - this.margin.left - this.margin.right)
  this.plotHeight = Math.max(1, h - this.margin.top  - this.margin.bottom)
}
```

### Split `render()` into `_prepareRender()` and `_drawSync(scissorBox)`

**`_prepareRender()` — async**, contains the current Phase 1 of `render()`:
- Refresh all `_dataTransformNodes` via `node.refreshIfNeeded(plot)`.
- Refresh all layer `_dataColumns` via `col.refresh(plot)`.
- All `tdrYield()` calls remain here.
- Does **not** touch the canvas or issue any draw calls.

**`_drawSync(scissorBox)` — sync**, contains the current Phase 2 of `render()`:
- Does **not** call `regl.clear()` (MasterCanvas does that before calling `_drawSync`).
- Viewport coordinates are offset by the scissor box origin:
  ```js
  const viewport = {
    x:      scissorBox.x + this.margin.left,
    y:      scissorBox.y + this.margin.bottom,
    width:  this.plotWidth,
    height: this.plotHeight,
  }
  const fullViewport = {
    x: scissorBox.x, y: scissorBox.y,
    width: scissorBox.width, height: scissorBox.height,
  }
  ```
- All layer draw calls, axis pre-pass (`prepareAtlas`), atlas flush, and axis render pass proceed unchanged; they just receive the offset viewport above.

### `scheduleRender()` — delegate to MasterCanvas

The throttle/blocked-lag logic stays in `scheduleRender()` (it can still defer via `setTimeout`), but the terminal action changes from queuing its own RAF to:

```js
getMasterCanvas().schedulePlotRender(this)
```

Remove `this._rafId`, `this._rendering`, and the double-RAF state from Plot — they move into MasterCanvas.

The blocked-lag EMA (`this._blockedLag`) is retained on Plot since it measures that plot's own render time versus its RAF wait time.

### `ResizeObserver`

Observe `this._placeholder` instead of `this.container` (same behaviour; placeholder fills the container). Callback is unchanged — defers to next RAF then calls `forceUpdate()` which calls `_applyUpdate()` then `scheduleRender()`.

### `destroy()`

Add at the start:
```js
getMasterCanvas().unregister(this)
```

---

## Part 4: `ResourceRegistry`

### New file: `src/core/ResourceRegistry.js`

Ref-counted registry for GPU resources that may be shared across plots.

```js
export class ResourceRegistry {
  constructor() {
    this._entries   = new Map()     // key → { resource, refCount }
    this._ownerKeys = new WeakMap() // owner → Set<key>
    this._fin = new FinalizationRegistry(keys => {
      for (const k of keys) this._releaseKey(k)
    })
  }

  acquire(key, createFn, owner = null) {
    if (!this._entries.has(key))
      this._entries.set(key, { resource: createFn(), refCount: 0 })
    this._entries.get(key).refCount++
    if (owner) {
      if (!this._ownerKeys.has(owner)) this._ownerKeys.set(owner, new Set())
      this._ownerKeys.get(owner).add(key)
      this._fin.register(owner, [key], owner)  // safety-net cleanup on GC
    }
    return this._entries.get(key).resource
  }

  _releaseKey(key) {
    const entry = this._entries.get(key)
    if (!entry) return
    if (--entry.refCount <= 0) {
      entry.resource.destroy?.()
      this._entries.delete(key)
    }
  }

  // Call from Plot.destroy() for explicit, immediate release.
  releaseOwner(owner) {
    this._fin.unregister(owner)
    for (const k of this._ownerKeys.get(owner) ?? []) this._releaseKey(k)
    this._ownerKeys.delete(owner)
  }
}

export const globalResourceRegistry = new ResourceRegistry()
```

### Apply to the colorscale texture

Currently each Plot recreates its colorscale texture whenever `getColorscalesVersion()` changes, then destroys the old one. Replace with:

```js
const key = `colorscale-v${getColorscalesVersion()}`
this._colorscaleTex = globalResourceRegistry.acquire(
  key,
  () => buildColorscaleTexture(this.regl),
  this
)
```

When `_initialize()` runs again (e.g. after data update), call `globalResourceRegistry.releaseOwner(this)` to drop the old texture before re-acquiring with the new version key.

Add `globalResourceRegistry.releaseOwner(this)` to `Plot.destroy()`.

---

## Part 5: Zero-copy selection sharing

### `writeVersion` on `SelectionColumn`

Add to the constructor:
```js
this.writeVersion = 0   // JS Number — exact integers up to Number.MAX_SAFE_INTEGER (2^53 − 1)
```

Increment in every write method:
```js
upload(arrays) { /* ... existing logic ... */ ; this.writeVersion++ }
clear()        { /* ... existing logic ... */ ; this.writeVersion++ }
```

### Shared `SelectionColumn` instances across plots

Currently `GlobalSelectionRegistry` creates one `SelectionColumn` per `(dataRef, selectionName, plot)` tuple, then `linkSelections()` copies data between them when a selection changes. Because all plots now share one regl context, a single `SelectionColumn` can be bound directly in any plot's draw call — no copy needed.

Change in `GlobalSelectionRegistry`:
- Key by `(dataRef, selectionName)` only — drop the `plot` dimension.
- First plot to access a `(dataRef, selectionName)` pair creates the `SelectionColumn`; subsequent plots reuse the same instance.
- `linkSelections(selA, selB)`: if both selections map to the same MasterCanvas, make both `Selection` proxies wrap the same `SelectionColumn` (rather than setting up a data-copy subscription).

### Version-aware render scheduling

Each `Plot` gains:
```js
this._consumedSelVersions = new Map()   // SelectionColumn → number
```

When a `SelectionColumn` is written: iterate `globalSelectionRegistry` for all plots that reference this column and call `plot.scheduleRender()` **only when**:
```js
col.writeVersion > (plot._consumedSelVersions.get(col) ?? -1)
```

After `_drawSync()` completes for a plot, for every `SelectionColumn` the plot consumed during that frame:
```js
plot._consumedSelVersions.set(col, col.writeVersion)
```

This guarantees each write produces at most one re-render per consumer and prevents A → B → A → B cycles.

---

## Part 6: Named framebuffer registry

### New file: `src/core/FramebufferRegistry.js`

```js
class FboEntry {
  constructor(regl, width, height) {
    this.texture      = regl.texture({ width, height, format: 'rgba', type: 'float' })
    this.fbo          = regl.framebuffer({ color: this.texture, depth: false })
    this.writeVersion = 0          // JS Number, same overflow guarantee as SelectionColumn
    this.producer     = null       // Plot that renders into this FBO
    this.consumers    = new Set()  // Plots that sample this FBO as a texture
  }
}
```

Hosted on `MasterCanvas` as `this.fboRegistry: Map<string, FboEntry>`.

### Render ordering

Before Phase 2 of `_tick()`, build a dependency graph over `toRender`:
- For each named FBO, the `producer` must appear before all `consumers` in the draw order.
- Topological sort (Kahn's algorithm) on `toRender`; cycles are an error.

### Plot config API

```js
// Producer — this plot renders its output into a named FBO each frame:
plot.update({ outputFramebuffer: 'myFbo', ... })

// Consumer — a layer attribute reads from a named FBO:
plot.update({
  layers: [{ myLayer: { xData: { fboInput: 'myFbo', channel: 'r' } } }]
})
```

### Version tracking

Same mechanism as selections:
- `fboEntry.writeVersion` is incremented after the producer's `_drawSync()` completes.
- Consumer plots are re-scheduled only when their `_consumedFboVersions.get(name)` is stale.
- Updated after `_drawSync()` in the consumer.

---

## Implementation Order

1. `src/core/initRegl.js` — extract from `GlBase._initRegl`; update `GlBase` to call it. No behaviour change.
2. `src/core/MasterCanvas.js` — canvas, regl, RAF loop, coordinate mapping, axis command singletons. Validate by creating a Plot and confirming a single canvas in the DOM.
3. `Plot.js` refactor — placeholder div, shared regl, `_updateDimensions`, `_prepareRender` / `_drawSync` split, `scheduleRender` delegation. Validate all existing examples still render correctly.
4. `src/core/ResourceRegistry.js` — ref counting + `FinalizationRegistry`; migrate colorscale texture. Validate no double-destroy errors on `Plot.destroy()`.
5. Zero-copy selections — `writeVersion` on `SelectionColumn`, shared instances, version-aware scheduling. Validate linked-selection example: one GPU texture, correct propagation, no infinite loops.
6. `src/core/FramebufferRegistry.js` — named FBOs, topological render sort, plot config API.

---

## Out of Scope

- DPR / HiDPI scaling: current convention (`canvas.width = CSS width`) is preserved. HiDPI support is a separate improvement.
- Multiple independent `MasterCanvas` instances per page.
- 3D camera: `_drawSync(scissorBox)` receives the scissor box; camera MVP is computed entirely in model/clip space and is unaffected.
- `SelectionPipeline` / `LassoInteraction`: these already use the plot's `this.regl`; with shared context they continue to work without changes.
