# Plan: Option B — OffscreenCanvas + per-plot bitmaprenderer compositing

## Background: why the flat single-context canvas failed

The `single-context` branch collapsed all plots onto **one** full-viewport canvas
(`MasterCanvas`, `z-index:1000`, `pointer-events:none`). That canvas is exactly **one
layer** in the DOM z-stack, so every plot's WebGL pixels live at the same z-level. The
native compositing that `master` got for free (each plot had its own `<canvas>` DOM
layer) had to be faked via the "owned sub-rects" scheme in `_tick()`: each plot's box
minus higher-z plot boxes minus `_getDocumentOverlays()` (a 4×4 `elementsFromPoint`
sample subtracting each overlay's axis-aligned `getBoundingClientRect`).

This can never be correct:

1. **Rectangular subtraction can't represent rounded/blurred chrome.** A `Float`'s
   `borderRadius:4px` corners and `box-shadow` are non-rectangular; punching a rectangle
   out of the lower plot deletes its content at the corners while the float chrome shows
   through — the "shadowing with semi-transparency and rounded corners" symptom.
2. **Semi-transparency is unrepresentable on a flat layer.** The float's
   `rgba(255,255,255,0.92)` background must blend *over the lower plot*, but the lower
   plot's pixels there were punched to transparent, so it blends over nothing.
3. **4×4 sampling is lossy** — thin borders, drag bars, small overlays between grid
   points are missed.

Root cause: **a single flat canvas is one compositor layer; you cannot interleave
`lowerPlotWebGL < floatChrome < floatWebGL` within one layer.** Hole-punching is a dead
end.

## The fix: stop being the compositor

Keep the **single shared regl context** (the entire reason for the refactor — zero-copy
`SelectionColumn` textures and named FBOs), but render it on an **`OffscreenCanvas`**.
Give each `Plot` back a real on-screen `<canvas>` — a lightweight `bitmaprenderer`
canvas, not a WebGL one — so every plot is again a normal DOM layer and **the browser
composites** (z-index, `border-radius`, alpha, shadows, checkboxes, modals). Per frame,
each dirty plot is rendered in the shared context and handed to its display canvas via
`transferToImageBitmap()` → `transferFromImageBitmap()` — a GPU-side handle move, no CPU
readback.

This is `master`'s DOM model with the many WebGL contexts replaced by many
`bitmaprenderer` contexts fed from one shared GL context.

## Branch

`single-context-offscreen`, branched from **`single-context`**. Option B reuses
everything `single-context` built — one shared regl context, shared `SelectionColumn`
instances, `FramebufferRegistry`, `ResourceRegistry`, FBO-based picking — and **only
replaces the compositing/display layer**. The flat overlay canvas and all hole-punching
are deleted.

---

## Part 1 — Spike (de-risk first, before the full refactor)

Stand up an `OffscreenCanvas` + one `Plot` + one `bitmaprenderer` display canvas and
confirm it renders **right-side-up**. WebGL draws bottom-left origin; the transfer pair
*should* preserve orientation, but this must be confirmed on the target browser before
anything else.

- If flipped: render with an inverted viewport (cheap, sync). Do **not** use
  `createImageBitmap(bmp, {imageOrientation:'flipY'})` — it is async and adds a frame of
  latency.

This spike resolves the single biggest unknown before touching the rest of the code.

---

## Part 2 — `src/core/MasterCanvas.js`

- **Constructor:** `this._offscreen = new OffscreenCanvas(1, 1)`;
  `this.regl = initRegl(this._offscreen)`. Remove `document.body.appendChild`, the
  `z-index`/`pointer-events`/`position:fixed` styling, and the visible canvas entirely.
  Keep `axisLineCmd`, `axisBillboardCmd`, `fboRegistry`.
- **Delete:** `_getEffectiveZOrder`, `_subtractRect`, `_getDocumentOverlays`,
  `_plotScissor`, the `plotBoxes` z-sort, and the entire owned-sub-rects loop.
- **`_tick()` Phase 2** iterates **only `dirty`** (not all `_plots`). Non-dirty plots keep
  their existing display bitmap and the browser keeps compositing them — a large win over
  the flat model, which redrew every plot every frame:
  ```js
  for (const plot of dirty) {
    const rect = plot._canvas.getBoundingClientRect()
    if (!this._isVisible(rect)) continue
    plot._updateDimensions(rect)
    const w = plot.width, h = plot.height
    if (this._offscreen.width  !== w) this._offscreen.width  = w   // resize only on change
    if (this._offscreen.height !== h) this._offscreen.height = h
    this.regl.poll()
    plot._drawSync()                                   // draws at origin into the offscreen
    plot._displayCtx.transferFromImageBitmap(this._offscreen.transferToImageBitmap())
  }
  ```
  Phase 1 (`_prepareRender` for all dirty plots in parallel) is unchanged.
- **`_isVisible`** stays (skip zero-size / off-screen plots).
- **Window resize handler** simplified to "reschedule all plots" (covers DPR changes);
  per-plot sizing is handled by each plot's `ResizeObserver`.

---

## Part 3 — `src/core/Plot.js`

- **Constructor:** replace the `_placeholder` div with a real display canvas:
  ```js
  this._canvas = document.createElement('canvas')
  this._canvas.style.cssText = 'display:block;position:absolute;top:0;left:0;width:100%;height:100%'
  container.appendChild(this._canvas)
  this._displayCtx = this._canvas.getContext('bitmaprenderer')
  ```
  Keep `this.regl = getMasterCanvas().regl` and `getMasterCanvas().register(this)`.
- **`_updateDimensions(rect)`:** also set the backing store
  `this._canvas.width/height = w/h` so the transferred bitmap displays 1:1.
- **`_drawSync()`** — drop the `scissorBox` / `clipRects` parameters. Reverts close to
  `master`'s Phase-2 render: viewport at **origin**
  (`x: margin.left, y: margin.bottom, width: plotWidth, height: plotHeight`), full
  viewport `{x:0, y:0, width, height}`, a single `regl.clear({color:[1,1,1,1]})` +
  layer draws + axis atlas prepare/flush + axis render. Remove every `scissorBox.x/y`
  offset (all become 0) and the `regl({scissor})` wrapping.
- **`_prepareRender()`** unchanged.
- **References:** `ResizeObserver.observe(this._canvas)`, `pick()`'s
  `getBoundingClientRect()` on `this._canvas`, `destroy()`'s `this._canvas.remove()`.
- **`scheduleRender()`** unchanged (still delegates to
  `getMasterCanvas().schedulePlotRender`).

---

## Part 4 — Floats and everything else: no changes

- `src/floats/Float.js`, `Colorbar.js`, `Filterbar.js`, `Colorbar2d.js` — **unchanged.**
  The subclasses override only `_syncBeforeDraw`/`destroy` (verified), never the
  `_drawSync` signature. The float chrome now composites correctly *because* each float's
  display canvas is a real DOM layer above the main plot's canvas. The fix is deleting
  code, not adding it.
- **Picking / selection / FBO sharing** — unchanged. `pick()` renders to its own FBO in
  the shared context and never touches a display canvas. Zero-copy `SelectionColumn`
  sharing and `FramebufferRegistry` are inherited from `single-context` untouched.

---

## Risks to validate early

1. **Y-flip** — resolved in the Part 1 spike.
2. **Offscreen resize churn** — resizing the offscreen per differently-sized plot
   reallocates the drawing buffer. Bounded because only *dirty* plots render each frame.
   Documented fallback if it shows in the numbers: hold the offscreen at the max plot
   size, render each plot at origin, display via a bitmaprenderer canvas sized to the
   plot. Decide from measurement.
3. **Browser support** — `OffscreenCanvas`+WebGL2 and `bitmaprenderer`
   (Chrome/Edge/FF, Safari 17+), within the project browserslist. Confirm in the target
   browser.

---

## Part 5 — Performance test harness

### One reusable bench file, public API only
`example/bench.js` + `example/bench.html`, using **only the stable public API**
(`Plot`, `PlotGroup`, `plot.selections`, zoom/`update`) so the *same file runs unmodified*
on both `master` and `single-context-offscreen`. Run both via **git worktrees** (one per
branch) on the same machine/browser for a clean A/B; capture the JSON output manually.

### Scenarios (URL param)
- **`?scene=single`** — one scatter `Plot`, no sharing.
- **`?scene=linked`** — two `Plot`s in a `PlotGroup` with a linked selection
  (`master` path = `linkSelections` copy; B path = shared instance).

Each at **10k / 100k / 1M / 5M** points.

### Metrics — vsync-proof
rAF interval is capped at ~16.7ms and would hide differences, so the **primary metric is
tight-loop throughput**:
- Run **M synchronous iterations** of `prepare→draw(→transfer)` in a loop, force GPU
  completion at the end (1px `readPixels` / `gl.finish`), report `wall / M` = ms per frame
  including GPU.
- Report **draw-only** vs **draw+transfer** separately to isolate the
  `transferToImageBitmap`/`transferFromImageBitmap` cost on B.
- Use `EXT_disjoint_timer_query_webgl2` for GPU-time-per-frame when available.
- Stats: median + p95 frame time, mean render time.
- Secondary sanity check: a deterministic scripted zoom ramp (N frames) with large data
  (exceeds vsync) as a real-interaction cross-check.

### Sharing scenario — headline measurement
Scripted selection sweep that changes the selected set every iteration; measure
**end-to-end selection-apply → both plots updated** wall time as N grows:
- `master`: includes the `SelectionColumn` copy between per-plot instances (an N-sized
  mask readback/re-upload — grows with N).
- B: shared instance, ~0 propagation cost.
- **Expected:** curves diverge as N grows — B flat, `master` rising. This is the
  quantitative justification for the single-context architecture.

### What we expect to prove
- **`single`:** B pays a small, ~constant per-plot `transfer` overhead (flat in
  resolution); `master` has none. B should be within noise of `master` — confirming the
  display path is cheap.
- **`linked`:** B wins increasingly with data size on selection propagation — sharing is
  zero-copy vs `master`'s per-update mask copy.

---

## Implementation order

1. **Spike** — OffscreenCanvas + one plot + one bitmaprenderer canvas; confirm
   right-side-up; resolve Y-flip. (De-risks the whole approach.)
2. `MasterCanvas` — offscreen + simplified `_tick`; delete hole-punching.
3. `Plot` — canvas/bitmaprenderer swap; `_drawSync` origin-viewport revert;
   `_placeholder`→`_canvas` references.
4. Validate all existing examples (esp. floats overlapping the main plot, and
   linked-scatterplots) render correctly.
5. `example/bench.js` + `bench.html`; set up master/B worktrees; collect numbers across
   sizes for both scenes.
6. Record results, move this plan to `docs/plans/done/`.

---

## Out of scope

- DPR / HiDPI scaling (unchanged from current convention).
- Multiple independent `MasterCanvas` instances per page.
- Any change to picking, selection semantics, FBO registry, or compute pipeline.
