# Plan: Axis context menu — the right-click event and the menu widget

## Overview

Add a right-click menu to every 2D plot that shows and hides each axis — and
separately its tick labels and its title — so a plot can drop a label to regain
room and get it back with one click. The same menu locks an axis's range and
resets the view.

This plan is the **UI layer**. Every setting it toggles and every behaviour it
triggers is defined by its sibling plan,
`docs/plans/axis-visibility-lock-reset.md` (Plan A): the `axes.<slot>` keys
`tickLabelsVisible`, `titleVisible`, `locked`, and the APIs `resetAxes()`,
`isAxisLocked()`, `setAxisLocked()`. The menu only *writes those keys and calls
those APIs*. It is stacked on Plan A and opened after it.

**Axis state is never menu state.** Because of Plan A's single-source-of-truth
rule, a toggle writes into `axes.<slot>` and round-trips through
`plot.getConfig()` automatically — so "save the switch into the layout" is just
setting a gladly config key, and a consumer that stores `plot.getConfig()` keeps
it with no extra work. The menu holds **no** axis state of its own, and there is
**no `menu:` config block** — the only things gladly cannot do itself (persist
across a reload, and fan a persist out across a linked workspace) are exposed as
a change event and a **code-level** item-registry hook, not as stored config.

**Enabling the built-in menus.** Two top-level config booleans gate whether
gladly's own menu is bound to the `'contextmenu'` event: `axis_menu` (the
single-axis menu on an axis-strip right-click) and `plot_menu` (the full menu on
a plot-area / corner / empty-margin / 3D right-click). Both default to true. These
are not axis state and not a `menu:` block — they only switch gladly's internal
binding on or off. When one is false, gladly does not open that menu and the
`'contextmenu'` event still fires, so a consumer can `plot.on('contextmenu', …)`
and bind anything of their own to it (their own menu, or any other behaviour).

**PR stack:** builds on Plan A, and on open PRs #36 (typed axis limits), #37
(selection shapes / the polygon's right press) and #38 (`marginWithoutAxis`).

## What exists

Read against master at `1e1c983` with #36, #37, #38 and Plan A applied.

- Plan A gives the axis keys, the margin reflow, `resetAxes()`, the lock APIs and
  the lock mark. This plan assumes all of that exists.
- The right button: `ZoomController` `preventDefault`s `contextmenu` on the
  canvas. On a 2D plot a right press does nothing; on 3D a right drag rotates.
  With #37 a right press closes a polygon in progress
  (`LassoInteraction._onMouseDown`, `e.button === 2`) on the mousedown, so by the
  time a `contextmenu` arrives the polygon is already gone and nothing records
  that the press was used.
- `plot.on(type, cb)` passes any DOM event type through as a capture listener and
  calls `cb(e, coords)`; `coords` from `lookup()` holds a value per axis that has
  a scale. `'error'`, `'no-error'`, and with #36 `'axislimit'`, are synthetic.
- `ZoomController._getRegion2D()` works out which axis strip a point is in; a
  corner or an empty margin is in no region. #36 uses it for the limit boxes.
- gladly already renders floating DOM widgets over the canvas (`floats/Float.js`,
  the colorbar/filterbar floats) and marks interactive DOM with
  `data-gladly-control` (#36's limit boxes). The menu reuses this layer.

## Part 1: The right-click event

A synthetic `'contextmenu'` plot event, `cb(e, coords)` like the DOM events, for a
right press+release less than 5 px apart **that gladly did not use**:

- A press that closed a polygon (`LassoInteraction` marks that press) or ended a
  3D rotation does not count.
- Fires on the **release**, so it behaves the same whether the browser's own
  `contextmenu` arrives at the press (macOS) or the release (Windows).
- gladly keeps blocking the browser's own menu on the canvas; presses on
  `data-gladly-control` elements (the limit boxes) are ignored, as for other
  events.
- The event carries **which axis strip** the press was on, from
  `_getRegion2D()`, or none for the plot area, a corner, an empty margin and any
  3D plot. How it is carried (a third argument or a field on `coords`) is for the
  review.

This replaces the plain DOM pass-through for the name `'contextmenu'`; a new name
(`'menu'`) works if the maintainer prefers to keep the pass-through.

Decided 2026-11-12: Enter also closes a polygon, as a second way beside the
right-click, whether or not Shift is held, so the corners and the close can all be
done without letting go of Shift. It goes into the shapes work (#37, about one
line) or this PR if #37 lands first. It also covers Firefox, which opens its own
menu on a Shift+right-click whatever the page does, so there Shift has to be
released before a right-click closes the polygon.

## Part 2: The menu widget

### Motivation

The menu is generic: its rows set `axes.<slot>` keys (Plan A) and call
`resetAxes()` / `setAxisLocked()`. Only two things are app-specific — persisting
across reload, and extra app rows (e.g. a status bar) — so gladly owns the menu
and exposes a code hook and an event for those. No app concept is hard-coded.

### The menu

Opened by the `'contextmenu'` event (when gated on — see **Enabling the built-in
menus** above: `plot_menu` for the full menu, `axis_menu` for the single-axis
menu), built as a gladly float/`data-gladly-control` widget positioned at the
pointer and kept on screen near the window edges; closed on Escape, a click
outside, or Reset view.

**Full menu** (plot-area / corner / empty-margin / 3D click): a row per 2D axis
present in `coords`, named by side + title (`axes[slot].label` or the quantity
kind's label), e.g. "Bottom: Distance [m]", with four checkboxes under **Axis**,
**Labels**, **Title**, **Lock**; then **Reset view**. A hidden axis keeps its row.
On a 3D plot, no axis rows (only injected items and Reset view, which is a no-op).

**Single-axis menu:** a right-click on an axis strip shows that axis's row only.
The left/right y and bottom/top x strips each get their own.

**Grey-out:** while an axis is hidden (`visible: false`), its Labels and Title
boxes are disabled but keep their state, so showing the axis again brings back
what it had. Lock stays live on a hidden axis (the range is kept whether drawn or
not). Lock reads `isAxisLocked`, so a lock held by a linked plot shows checked.

### What a toggle does

- **Axis / Labels / Title:** set `visible` / `tickLabelsVisible` / `titleVisible`
  on the slot and re-render. These go through the normal config path — i.e. they
  write `axes.<slot>`, so the margin rule in Plan A reflows and the change
  round-trips through `getConfig()`.
- **Lock:** `setAxisLocked(slot, on)` (no `update()`).
- **Reset view:** `resetAxes()`.

The menu does not emit an event of its own. The settings it writes —
`visible` / `tickLabelsVisible` / `titleVisible` / `locked` on a slot — emit an
**`'axisoptions'`** event from the **write path**, keyed by *what* changed, not by
who changed it, exactly like `'axislimit'` (`_emitAxisLimit`, fired by the typed
editor and re-emitted by the colorbar/filterbar floats). It carries
`{ type: 'axisoptions', axis: slot, key, value }` and fires wherever those keys
are written — `setAxisLocked()` and the visibility/labels/title config writes —
so a direct `plot.update({config})` or `setAxisLocked()` call, and propagation
from a linked plot, emit it too; the menu is just one more source. A consumer
persists on `'axisoptions'` (and `'axislimit'` for domain changes) and never has
to know a menu was involved. The checkboxes read live config so the menu shows
the real state as the plot rebuilds behind it.

### Extension hook — a code registry, not config

A way for the host to contribute rows/items the menu renders alongside the axis
rows — e.g. a workspace status-bar toggle, or future plot-area items. This is a
**code-level** registry (e.g. `plot.menuItems`: a `(context) => itemDescriptor[]`
list of callbacks), **not** a `menu:` config block — axis state stays solely in
`axes.<slot>` (Plan A's rule), and host rows are host responsibility. A host app
registers its rows through this hook and persists its own rows' state itself; the
axis rows need no host wiring beyond reacting to `'axisoptions'`. This is the only
seam a host app touches.

Nothing here hard-codes an app concept; any status bar and persistence are the
host's, injected through the code hook and the event.

## Docs

- `docs/user-api/Plot.md`: the `'contextmenu'` and `'axisoptions'` events, the
  `axis_menu` / `plot_menu` config booleans, the `plot.menuItems` menu-item hook.
  (The `resetAxes()`/`isAxisLocked()`/`setAxisLocked()` entries are Plan A's.)
- `docs/architecture/`: the menu widget alongside the other floats.

## Tests (web-test-runner, `test/`)

The event:

- A right press+release emits `'contextmenu'` once with coordinates; a right
  press that closes a polygon emits nothing; a right drag on 3D emits nothing.
- The event names the axis strip a right-click was on, and none for the plot area
  and a corner.

The menu:

- A right-click in the plot area opens a full menu with a row per 2D axis; a
  right-click on an axis strip opens that axis's row only.
- With `plot_menu: false` a plot-area right-click opens no menu but still fires
  `'contextmenu'`; with `axis_menu: false` an axis-strip right-click opens no menu
  but still fires the event.
- Toggling Axis/Labels/Title sets the config key and reflows the margin; toggling
  Lock calls `setAxisLocked` and rebuilds no layers; Reset view calls
  `resetAxes()`.
- A hidden axis's Labels/Title boxes are disabled and keep their state; Lock stays
  live and shows a lock held by a linked plot.
- Toggling Axis/Labels/Title or Lock emits `'axisoptions'` once with
  `{ axis, key, value }`; a direct `setAxisLocked()` (no menu) emits the same
  event; an injected host item (via `plot.menuItems`) renders and toggles.
- Escape / outside-click / Reset view close the menu.

## Order and releases

Stacks on Plan A (`axis-visibility-lock-reset.md`) and on #37 (the polygon's
right press). Opened once Plan A lands, or stacked on it. Whether it ships in the
same release as Plan A and #36–#38 is the maintainer's call; one release keeps a
consumer to a single bump.

## Not in this plan

- The axis keys, the margin rule, the lock behaviour, `resetAxes()` — those are
  Plan A.
- Touch long-press; a Mac Ctrl+click as a right-click.
- A right-click on a color bar or filter bar; color/filter axes in the menu.
- Axis rows, reset and the lock mark on 3D plots; a 3D plot only obeys a lock set
  on a linked 2D axis.
- App-specific menu items (e.g. a status bar) — those come through the
  `plot.menuItems` hook from the host, along with the host's persistence.

## Implementation steps

1. The `'contextmenu'` event with the axis it was on (and the Enter-closes-polygon
   line if #37 has landed); tests and docs.
2. The `'axisoptions'` event, emitted from the `axes.<slot>`
   visible/labels/title/lock write path (a `_emitAxisOptions` + `_axisOptions`-
   Listeners set, mirroring `_emitAxisLimit`); tests and docs.
3. The menu widget (rows, checkboxes, context-sensitivity, grey-out, positioning,
   gated by `axis_menu` / `plot_menu`) and the `plot.menuItems` hook; tests and
   docs.
4. A release (maintainer's step).

One PR to `redhog/gladly`, stacked on Plan A. About half a day.
