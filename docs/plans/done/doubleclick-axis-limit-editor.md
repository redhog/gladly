# Double-Click Axis Limit Editor — 2D + 3D

## Overview

Replace the current **hover** trigger of `AxisLimitEditor` with a **double-click**, extend it to
**3D plots**, and open only a **single** input box — the axis end nearest the click — pre-filled with
that end's current value.

The feature itself is unchanged in intent: let the user type an exact end value for a spatial axis
(and, via the float relays, for colorbar/filterbar axes) instead of zooming or dragging to it. Only
the way the editor is summoned and placed changes.

## Why

The hover trigger is too intrusive: the trigger zone is the *entire* axis margin band (see
`ZoomController._getRegion2D`), so merely moving the cursor into the bottom/left/right/top strip pops
**both** end boxes into view on plain `mousemove`, with no delay. Hover was also the only reason 3D
was excluded — placing two persistent boxes at projected endpoints that rotate with the camera was
awkward, so 3D plots got no editor at all.

Double-click removes all of that:

- It is a deliberate gesture, so nothing appears while the user is just panning/looking.
- Double-click on an axis is currently **bound to nothing** — no `dblclick` handler exists anywhere
  in `src/`; the only canvas mouse events are `contextmenu`, `mousedown`, `touchstart/move/end`, and
  `wheel`. The gesture is free to claim.
- The click position disambiguates **which end** the user means, so we open one box, not two.
- Axis-region detection already works identically in 2D and 3D (`ZoomController._getRegion` dispatches
  to `_getRegion2D` / `_getRegion3D`, both returning `{ axes:[axisId], type:'axis' }`), and in 3D only
  **front-facing** axes on their **outward** side are hit (`facingCam <= 0` and `signedDist <= 0` are
  culled). The clicked axis is therefore always visible and its ends are never occluded — 3D placement
  is viable.

## Interaction

- **Trigger:** double-click an axis band. Replaces hover entirely (hover reveal is removed).
- **Which end:** the end nearest the click, via `_unproject` (the same primitive drag uses). The
  unprojected point is in normalised axis space where the axis runs `-1` (domain[0], the "min" end) →
  `+1` (domain[1], the "max" end) along its `dir` component, so the sign of that component is the
  nearest end. This is a screen/positional judgement, so it stays correct on log and reversed axes
  without inverting the scale or comparing data values.

  ```js
  const world = plot._zoomController._unproject(mx, my)
  const idx = { x: 0, y: 1, z: 2 }[AXIS_GEOMETRY[axisId].dir]
  const end = world[idx] < 0 ? 'min' : 'max'
  ```

- **Field:** a single inline `<input>` at the chosen end, pre-filled with that end's current value
  (formatted), focused with its text selected. Tagged `data-gladly-control="axis-limit"` so
  `Plot.on()`'s control filter keeps suppressing the click underneath.
- **Keys / dismissal:**
  - **Enter** → commit and close.
  - **Tab** → commit, close, open the other end.
  - **Escape** → cancel (close without applying).
  - **Blur / click-away** → commit if valid, drop if invalid (today's behaviour).
  - An invalid value on commit marks the box (red border) with the reason in its `title`, and keeps
    the box open on Enter.
- **Placement:** 2D on the tick-label row at the chosen end (unchanged look); 3D at the projected
  endpoint.
- **3D rotate-while-editing:** no special handling. Starting a rotation is a `mousedown` on the
  canvas, which blurs the open input → it commits and closes.
- **Validation** is unchanged (`parseAxisLimit`): refuses a non-number, a value equal to the other
  end, a value that would flip the axis, or `<= 0` on a log axis.
- **Value application** is unchanged: `plot._getAxis(id).setDomain(...)` (so linked axes follow and
  the value lands in `getConfig().axes`), followed by the `'axislimit'` event. The colorbar / 2D
  colorbar / filterbar float relays are untouched.

## Implementation

### `src/axes/ZoomController.js`

Add one small helper used only for **placement** (end selection uses `_unproject`, see above):

```js
// Container-pixel position of one end of an axis, for placing the limit box.
axisEndScreenPos(axisId, end)  // end ∈ {'min','max'} → [x, y]
```

- 2D: from `margin` / `plotWidth` / `plotHeight`, offset onto the tick-label row (reuse
  `TICK_LABEL_FRAC` from `Axis.js`). This absorbs the 2D geometry that lived in
  `AxisLimitEditor.endPositions`.
- 3D: `axisEndpoints(axisId)` gives `start` (the `-1`/min end) and `end` (the `+1`/max end);
  `projectToScreen(point, this._computeAxisMvp(), width, height)` returns the pixel. `projectToScreen`
  output is already in the same container-relative pixel space the region math compares against, so no
  offset correction is needed.

### `src/axes/AxisLimitEditor.js`

Significant simplification — the persistent two-box model goes away:

- Replace the `mousemove` / `mouseleave` listeners with a single `dblclick` handler on `plot._canvas`.
- `_handleDblClick(e)`: compute container-relative `mx,my`; `region = _zoomController._getRegion(mx,my)`;
  bail unless `region?.type === 'axis'`; `axisId = region.axes[0]`; bail unless the axis is drawn and
  visible; choose `end` from the `_unproject` sign; `_startEdit(axisId, end)`.
- Delete `_show`, `_hide`, `_shownAxis`, `_handleMouseMove`, the `_boxes` Map, and the 2D-only
  `endPositions`. One transient `<input>` is created at edit start and removed on close; its position
  comes from `_zoomController.axisEndScreenPos(axisId, end)`.
- Remove the `_is3D` early-return — 3D is now supported.
- Keep `parseAxisLimit` and the `_commit` logic (parse → `setDomain` → emit `'axislimit'`) as-is.
- `destroy()` removes the `dblclick` listener and any open input.

### `src/axes/Axis.js`

`formatTick` stays exported (still used by the editor). `TICK_LABEL_FRAC` is now consumed inside
`ZoomController.axisEndScreenPos` rather than by the editor; keep it exported.

### Tests — `test/axis-limit-editor.test.js`

Rework the trigger/placement/3D cases; keep the rest:

- Trigger via `dblclick` instead of `mousemove`.
- Nearest-end selection: a double-click near the min end opens the min box, near the max end opens the
  max box.
- Flip "3D plot gets no boxes" into "3D plot opens a box on a front-facing axis".
- Enter commits and closes; Tab commits/closes/opens the other end; Escape cancels; blur commits.
- Keep: the invalid-value cases, unchanged-value no-op, reversed axis, log axis, hidden axis, a linked
  axis on a second plot, a value typed on a colorbar, the `Plot.on()` click filter, and `destroy()`.
- `parseAxisLimit` unit tests are unchanged.

### Docs

- `docs/configuration/PlotConfiguration.md` — rewrite the Typed Axis Limits section: double-click
  (not hover), one end at a time, now works in 3D.
- `CLAUDE.md` — update the `AxisLimitEditor.js` file-list line ("double-click an axis end to type its
  value; 2D and 3D").
- `docs/architecture/Modules.md` / `overview.md` — adjust if they describe the hover trigger or the
  2D-only restriction.
- `docs/user-api/Plot.md`, `docs/user-api/Widgets.md`, `docs/user-api/ColorbarsFilterbars.md` — the
  `'axislimit'` event and the `on()` control filter are unchanged; touch only wording that mentions
  hover.
- `PR.md` — update to describe the double-click / single-end / 3D behaviour.

## Decisions (resolved with the user)

- Inline boxes at the axis ends (not a popup panel).
- Double-click trigger, not hover.
- One box — the end nearest the click — not both ends.
- Nearest end chosen from the click's `_unproject`ed position, not endpoint-distance in pixels.
- Tab commits, closes, and opens the other end.
- Enter commits and closes; input pre-filled with the current value.
- 3D supported.
