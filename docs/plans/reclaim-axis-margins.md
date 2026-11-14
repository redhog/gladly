# Plan: Reclaim axis margins (additive margin model)

## Overview

A plot should only reserve the margin it actually draws into. Today it does not:
whenever a side has **no axis** (the slot is empty, or `visible: false`), or the
axis is present but its **title** or its **tick labels** are hidden, the full
60 px margin stays reserved and the plot area never grows to fill it.

The reclaim logic was already written (`Plot._layoutMargin`,
`src/core/Plot.js:685`) but is a no-op in practice — see Root Cause. This plan
replaces the broken subtractive-with-floor model with a straightforward
**additive** model: each side's margin is the sum of the bands it actually
draws, plus a small configurable outer pad.

This is a breaking change to the `Plot` constructor (the `margin` /
`marginWithoutAxis` options are removed) and to the float widgets
(`Colorbar`, `Filterbar`, `Colorbar2d`), consistent with the project's
no-backwards-compatibility rule.

## Root cause (why the existing reclaim is a no-op)

`Plot._layoutMargin()` starts from the full margin and subtracts hidden bands,
clamped to a floor:

```js
const floor = this._marginWithoutAxis[side] ?? this._marginWithAxis[side]
if (!drawsAxis(axisId)) return floor         // no axis → floor
...
return Math.max(m, floor)                     // partial → clamped up to floor
```

`marginWithoutAxis` defaults to `{}` in the constructor
(`src/core/Plot.js:223`), and **no consumer ever passes it** (confirmed across
`src/`, `example/`, docs). So `floor` always falls back to
`_marginWithAxis[side]` — the full 60 px margin. Result:

- **No axis / hidden axis** → returns `floor` = full margin → nothing reclaimed.
- **Title or ticks hidden** → `Math.max(m, floor)` clamps back to full margin →
  nothing reclaimed.

The band-subtraction math and the font-measured `tickLabelBandPx` /
`titleBandPx` are correct; they are simply defeated by the floor default.

## Design decisions (settled with the user)

- **Additive model**, per side:

  ```
  show_axis      = getScale(axisId) != null && axes[axisId].visible !== false
  show_tickmarks = show_axis && axes[axisId].tickLabelsVisible !== false
  show_title     = show_axis && axes[axisId].titleVisible     !== false

  margin[side] =
    show_axis
      ? TICK_BAND_PX                              // the tick-mark / axis-line band
        + (show_tickmarks ? tickLabelBandPx : 0)  // measured number-label band
        + (show_title     ? titleBandPx     : 0)  // measured title band
        + margins.visible                         // small outer pad
      : margins.hidden                            // axis absent / hidden
  ```

- `margins.visible` and `margins.hidden` live in **`currentConfig.margins`**,
  both **default 5 px**. They are config, not constructor args, so they
  round-trip through `getConfig()` and reflow on `update()` like any other key.

- **No cross-side coupling / no edge-overflow handling.** A label-free side
  collapses to `margins.hidden`; the perpendicular axis's first/last tick label
  may clip there. Accepted for now — revisit only if it reads badly in practice.

- **No constructor override.** The `margin` and `marginWithoutAxis` constructor
  options are removed. The float widgets migrate onto the additive model (drop
  their hand-tuned `DEFAULT_MARGINS`).

- **3D plots** keep a fixed full margin on every side (unchanged look). The 2D
  band math does not apply to axes drawn in model space.

## Implementation

### 1. Bands self-zero when their part is hidden — `src/axes/Axis.js`

Make the two font-measured band helpers return `0` when their part is not drawn.
This is the keystone: the same two methods feed the margin math
(`_layoutMargin`), the in-render title/label placement
(`labelModelDist` / `titleModelDist`, `Axis.js:299-303`), and the band
hit-testing in `ZoomController` (`labelAnchorPx` / `titleBandStartPx`). Zeroing
them in one place makes all three consistent — in particular it fixes the
secondary bug where a title with hidden tick labels floats out past the absent
label band and clips, because `titleModelDist` adds `labelBand` unconditionally
today.

- `tickLabelBandPx(atlas)` — return `0` when
  `axes[name].visible === false` **or** `axes[name].tickLabelsVisible === false`
  (in addition to the existing `!scale || !atlas` guard).
- `titleBandPx(atlas)` — return `0` when
  `axes[name].visible === false` **or** `axes[name].titleVisible === false`
  (in addition to the existing no-qk / no-label guards).

Read the axis config the same way the methods already read it
(`this._plot.currentConfig?.axes?.[this._name] ?? {}`, as in `titleBandPx`).

`TICK_BAND_PX` stays unconditional for a drawn axis — the tick marks render
regardless of `tickLabelsVisible` (`Axis.render` section 2 is before the
`tickLabelsVisible` gate), so it belongs to `show_axis`, not `show_tickmarks`.

### 2. Rewrite `_layoutMargin()` — `src/core/Plot.js`

Replace the subtractive body with the additive model. Because step 1 makes the
band helpers self-zero, the per-side rule is just:

```js
_layoutMargin() {
  const sideAxis = { top: 'xaxis_top', right: 'yaxis_right', bottom: 'xaxis_bottom', left: 'yaxis_left' }
  const axes  = this.currentConfig.axes ?? {}
  const m      = this.currentConfig.margins ?? {}
  const visPad = m.visible ?? 5
  const hidPad = m.hidden  ?? 5
  const atlas  = this._tickLabelAtlas

  const sideMargin = (side, axisId) => {
    if (this._is3D) return MARGIN_3D
    const drawsAxis = this.axisRegistry.getScale(axisId) !== null && axes[axisId]?.visible !== false
    if (!drawsAxis) return hidPad
    const axis = this._getAxis(axisId)
    return TICK_BAND_PX + axis.tickLabelBandPx(atlas) + axis.titleBandPx(atlas) + visPad
  }

  this.margin = Object.fromEntries(
    Object.entries(sideAxis).map(([side, axisId]) => [side, sideMargin(side, axisId)]))
  this.plotWidth  = Math.max(1, this.width  - this.margin.left - this.margin.right)
  this.plotHeight = Math.max(1, this.height - this.margin.top  - this.margin.bottom)
  this.axisRegistry.resize(this.plotWidth, this.plotHeight)
}
```

- Import `TICK_BAND_PX` from `../axes/Axis.js` (already exported).
- Add a module const `MARGIN_3D = 60` (the old all-sides default) for 3D plots.
- No separate `show_tickmarks` / `show_title` multipliers — the band helpers
  already return 0 when hidden (step 1).

### 3. Constructor — `src/core/Plot.js`

- Remove the `{ margin, marginWithoutAxis }` destructuring; constructor becomes
  `constructor(container)`.
- Remove `this._marginWithAxis` / `this._marginWithoutAxis`.
- Keep a bootstrap `this.margin` so early reads before the first
  `_layoutMargin()` are safe — initialise to a uniform `{ top, right, bottom,
  left }` using the 5 px default (e.g. `MARGIN_3D` is only for 3D; use a small
  constant here). `_layoutMargin()` overwrites it during `_initialize()`.

### 4. Config schema — `src/core/Plot.js` (schema builder, ~line 67)

Add a `margins` property alongside `axes` / `layers`:

```js
margins: {
  type: "object",
  description: "Outer padding (px) added once per side: 'visible' on a side that draws an axis, 'hidden' on a side with no axis.",
  properties: {
    visible: { type: "number", default: 5 },
    hidden:  { type: "number", default: 5 }
  }
}
```

`_layoutMargin` already defaults each to 5 inline, so an absent `margins` block
behaves identically — the schema entry is for the editor and documentation.

### 5. Migrate the float widgets

Each float extends `Plot` and currently passes `super(container, { margin })`.
Remove the `margin` option and the `DEFAULT_MARGINS` constant; call
`super(container)`. Their single spatial axis then drives the additive margin on
its side (`bottom` for horizontal, `left` for vertical; `bottom`+`left` for the
2D colorbar), with the other sides collapsing to `margins.hidden` (5 px).

- `src/floats/Colorbar.js` — drop `DEFAULT_MARGINS`, `{ orientation, margin }` →
  `{ orientation }`, `super(container)`.
- `src/floats/Filterbar.js` — same.
- `src/floats/Colorbar2d.js` — drop `DEFAULT_MARGIN`, `{ margin }` → `{}`,
  `super(container)`.

**Verify after migration** (manual, in the running example):
- The float overlays positioned relative to the plot — the drag bar
  (`DRAG_BAR_HEIGHT`) and the `∞` clamp checkboxes (`_addCheckboxOverlays`) —
  still sit correctly now that the margins are thinner.
- The colorbar/filterbar value axis labels at the two ends are not clipped
  badly. If they are, that is the accepted edge-overflow trade-off; note it and
  we decide whether to circle back (per the user, only if it "doesn't work very
  well").

### 6. Documentation

- `docs/architecture/Modules.md` — rewrite the `_layoutMargin()` paragraph for
  the additive model.
- `docs/architecture/DataFlow.md:100` — update the per-side margin note.
- `docs/configuration/PlotConfiguration.md` — document `margins.visible` /
  `margins.hidden`.
- Remove any `margin` / `marginWithoutAxis` constructor mentions in
  `docs/user-api/` and the Quickstart if present.

## Files touched

- `src/axes/Axis.js` — `tickLabelBandPx` / `titleBandPx` self-zero when hidden.
- `src/core/Plot.js` — rewrite `_layoutMargin`; constructor loses `margin` /
  `marginWithoutAxis`; add `MARGIN_3D`; add `margins` to the config schema.
- `src/floats/Colorbar.js`, `src/floats/Filterbar.js`,
  `src/floats/Colorbar2d.js` — drop `DEFAULT_MARGINS`, migrate to additive.
- Docs as listed in step 6.

## Out of scope / deferred

- Edge-label overflow handling on label-free sides (half-edge gutter or per-side
  `margins.hidden`). Deferred unless the accepted clipping reads badly.
- Any change to 3D axis margins beyond preserving the current fixed value.

## Verification checklist

- Empty slot (e.g. no `xaxis_top`) → top margin is `margins.hidden`, plot grows
  upward.
- `axes.yaxis_left.visible = false` → left margin is `margins.hidden`.
- `titleVisible: false` → that side loses exactly the title band; the title does
  not reappear elsewhere.
- `tickLabelsVisible: false` → that side loses the label band **and** the title
  (if shown) slides inward to sit against the tick band (no gap, no clip).
- Toggling any of these via the axis menu reflows the margin live (menu writes
  config → `update()` → `_initialize()` → `_layoutMargin()`).
- 3D plot margins unchanged.
- All `example/` pages and the float widgets render without clipped plot content.
