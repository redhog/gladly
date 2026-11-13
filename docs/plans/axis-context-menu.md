# Plan: Axis context menu — parts, range lock, reset

## Overview

Add a right-click menu to every 2D plot that shows and hides each axis — and
separately its tick labels and its title — so a plot can drop a label to regain
room and get it back with one click. The same menu locks an axis's range and
resets the view.

The menu, its layout, the right button it opens on, and everything the menu does
all belong to gladly. The axis-part keys and the lock are plain `axes.<slot>`
config, so a consumer that stores `plot.getConfig()` keeps them with no extra
work; the one thing gladly cannot do itself — persist across a reload, and fan a
persist out across a linked workspace — is exposed as a change event and an
injection hook. A host app that wants extra rows (e.g. a status-bar toggle) and
reload persistence adds only those through the hook and the event.

The menu is generic plotting functionality, not app-specific: because a plot
pane's stored config **is** `plot.getConfig()`, "save the switch into the layout"
is just setting a gladly config key.

**PR stack:** builds on open PRs #36 (typed axis limits), #37 (selection shapes /
the polygon's right press) and #38 (`marginWithoutAxis`).

## What exists

Read against master at `1e1c983` with #36, #37, #38 applied.

- `axes.<slot>.visible: false` hides an axis whole: `Axis.prepareAtlas()` and
  `Axis.render()` return early (`src/axes/Axis.js`). There is no switch for the
  tick labels alone or the title alone. The title is `axes.<slot>.label`,
  falling back to the quantity kind's label; an empty `label` already draws no
  title, but the text is then lost and no room is freed.
- In 2D the tick marks, tick labels and title sit at fixed fractions of the
  axis-to-edge distance (0.12, 0.40, 0.75 of the margin). This is why a side
  cannot shrink below ~48 px (x) / ~80 px (y) without collisions.
- #38: a side's margin is `margin[side]` when it draws an axis and
  `marginWithoutAxis[side]` when it draws none (including a `visible: false`
  axis). `_layoutMargin()` recomputes on every `update()`. A 3D plot keeps
  `margin` on every side.
- The right button: `ZoomController` `preventDefault`s `contextmenu` on the
  canvas. On a 2D plot a right press does nothing; on 3D a right drag rotates.
  With #37 a right press closes a polygon in progress
  (`LassoInteraction._onMouseDown`, `e.button === 2`) on the mousedown, so by the
  time a `contextmenu` arrives the polygon is already gone and nothing records
  that the press was used.
- `plot.on(type, cb)` passes any DOM event type through as a capture listener and
  calls `cb(e, coords)`; `coords` from `lookup()` holds a value per axis that has
  a scale. `'error'`, `'no-error'`, and with #36 `'axislimit'`, are synthetic.
- `ZoomController._getRegion2D()` works out which axis strip a point is in (an
  axis hidden with `visible: false` counted too); a corner or an empty margin is
  in no region. #36 uses it for the limit boxes.
- Linked axes (`linkAxes`) pass a domain on in `Axis.setDomain()`. Auto-fit
  (`AxisRegistry.applyAutoDomainsFromLayers`) computes each quantity kind's data
  range but keeps it (`dataExtent`) only for filter axes, and sets domains
  without going through `Axis.setDomain()`, so a refit does not reach linked
  plots. A slot's config `min`/`max` win over the data range; a quantity kind
  with no range falls back to 0..1.
- Every zoom/pan gesture ends in `Axis.setDomain()`, called by `ZoomController`
  once per axis it moves; a gesture on an axis strip moves that axis only, one in
  the plot area moves every axis.
- gladly already renders floating DOM widgets over the canvas (`floats/Float.js`,
  the colorbar/filterbar floats) and marks interactive DOM with
  `data-gladly-control` (#36's limit boxes). The menu reuses this layer.

## Part 1: Axis-part visibility and the margin rule

### Motivation

Give an axis side its room back when a part is hidden, not only when the whole
axis is. A stacked short strip above a profile spends most of its height on axis
labels; dropping the strip's x title should return ~20 px.

### Keys

Two new booleans in each `axes.<slot>`, default `true`, beside `visible`:

| key | hides |
|---|---|
| `tickLabelsVisible` | the numeric tick labels only |
| `titleVisible` | the axis title only |

`Axis.prepareAtlas()` and `Axis.render()` skip the tick labels, or the title,
when its key is `false`. The three switches are independent; a title with no
labels is possible though rarely wanted. Works on 3D plots too (margins there do
not change).

### Pixel layout and margin

In 2D, place the tick marks, tick labels and title at **fixed pixel distances**
from the axis line instead of fractions of the margin:

- Tick marks ~6 px long.
- Tick labels start ~2 px past the ticks: x labels centred on their tick with the
  near edge there; y labels aligned on that edge, using each label's width from
  the atlas.
- Title centred in a ~20 px band (one 16 px row + a gap) at the outer margin edge.

`_layoutMargin()` starts from `margin[side]` for a side drawing every part, takes
off the title band when the title is hidden and the label band (what is between
the tick band and the title band) when the labels are hidden, and never goes
below `marginWithoutAxis[side]`. A side drawing only its line and ticks therefore
gets `marginWithoutAxis`, like a side with no axis.

With example totals (48 px x / 80 px y full; 24 px no-axis): an x side is 48 px
full, ~28 px without its title, 24 px with neither labels nor title; a y side is
80 / 60 / 24 px. Exact pixels for the review. A plot that hides nothing keeps
#38's margins exactly.

## Part 2: The right-click event

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

## Part 3: Range lock

### Motivation

Pin an axis's range for a review so it survives zoom/scroll/pan on any plot, and a
reset, until switched off.

### State and API

A `locked` key in each `axes.<slot>`, default `false`, read into the axis at
`update()` and returned by `getConfig()`.

- `plot.isAxisLocked(slot)` → true when the slot holds the lock, when an axis
  reached through `_linkedAxes` (followed with a visited set) holds it, or when
  another slot of the same plot with the same quantity kind holds it.
- `plot.setAxisLocked(slot, on)` → sets it on that slot, or clears it on every
  axis `isAxisLocked` looks at, then **renders again without `update()`** (no
  layer rebuild).

### Enforcement

`ZoomController`'s drag, wheel and touch handlers **skip a locked axis before
calling `setDomain()`**, so the free axes of the same gesture still move. A
gesture in the plot area of a plot with x locked and y free moves y only. Covers
3D plots, which obey a lock set on a linked 2D axis.

Nothing in `Axis.setDomain()`, `AxisLink`, `AxisLimitEditor` or `update()`
changes. Therefore:

- A typed limit (#36) **still moves** a locked axis and its linked axes (typing is
  deliberate); the lock stays on. #36 needs no change.
- The fit to data never reaches a locked axis anyway (its config `min`/`max` win).
- The lock refuses a gesture *before* any domain is set, so any other path that
  sets a domain still reaches a locked axis. A test pins this (`setDomain()` still
  moves a locked axis).

### Lock mark

A small lock glyph drawn beside the title of each 2D axis that `isAxisLocked`, on
every plot, with a "locked" tooltip. A hidden axis draws no mark (its lock shows
in the menu). Where the mark sits when the title is hidden is for the review.
Display-only at first (the menu is one right-click away).

## Part 4: Reset

`plot.resetAxes()` sets each 2D spatial axis that has a scale to its data range
through `Axis.setDomain()`, so linked axes in other plots follow and nothing else
moves. It keeps a reversed axis reversed and a log axis above zero, as auto-fit
does. Needs `applyAutoDomainsFromLayers()` to keep `dataExtent` for **every**
quantity kind, not only filter axes. Color and filter axes are left alone;
locked axes are skipped. On a 3D plot it does nothing.

## Part 5: The menu widget

### Motivation

The menu is generic: its rows set `axes.<slot>` keys and call `resetAxes()` /
`setAxisLocked()`. Only two things are app-specific — persisting across reload,
and extra app rows (e.g. a status bar) — so gladly owns the menu and exposes a
hook and an event for those.

### The menu

Opened by the `'contextmenu'` event, built as a gladly float/`data-gladly-control`
widget positioned at the pointer and kept on screen near the window edges; closed
on Escape, a click outside, or Reset view.

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
  on the slot and re-render (these go through the normal config path, so the
  margin rule in Part 1 reflows).
- **Lock:** `setAxisLocked(slot, on)` (no `update()`).
- **Reset view:** `resetAxes()`.

After any menu-driven change, the plot emits a **`'menuchange'`** event (name for
the review) so the consumer can persist. The checkboxes read live config so the
menu shows the real state as the plot rebuilds behind it.

### Extension hook

A way for the host to contribute rows/items the menu renders alongside the axis
rows — e.g. a workspace status-bar toggle, or future plot-area items. A host app
wanting such a row registers it through this hook and reacts to `'menuchange'` to
persist its state. Shape for the review; options: a `plot.menuItems` registry of
`(context) => itemDescriptor[]`, or a `menu:` config block. The host's items get
the same `'menuchange'` on toggle. This is the only seam a host app touches.

Nothing here hard-codes an app concept; any status bar and persistence are the
host's, injected through the hook and the event.

## Docs

- `docs/user-api/Plot.md`: the `'contextmenu'` and `'menuchange'` events,
  `resetAxes()`, `isAxisLocked()`, `setAxisLocked()`, the menu-item hook.
- `docs/configuration/PlotConfiguration.md`: `tickLabelsVisible`, `titleVisible`,
  `locked`; the margin rule; what a lock stops and what it does not.
- `docs/architecture/`: where the 2D axis pixel layout is described; the menu
  widget alongside the other floats.

## Tests (web-test-runner, `test/`)

Parts 1–4 (behaviour):

- A hidden title or tick labels draw nothing of that part.
- Each hidden part narrows its side by its band; no side goes below
  `marginWithoutAxis`; a plot that hides nothing keeps #38's margins.
- A right press+release emits `'contextmenu'` once with coordinates; a right
  press that closes a polygon emits nothing; a right drag on 3D emits nothing.
- The event names the axis strip a right-click was on, and none for the plot area
  and a corner.
- `resetAxes()` sets the data range on a zoomed axis, keeps a reversed axis
  reversed, refuses zero on a log axis, moves a linked axis on a second plot and
  leaves its unlinked axis alone.
- Lock: a locked axis ignores wheel, drag and touch; so does an axis linked to it
  on a second plot, and one linked through a third; a wheel in the plot area of a
  plot with x locked moves y only; a typed limit moves a locked axis and its
  linked axes; `setDomain()` still moves a locked axis; `resetAxes()` leaves a
  locked axis; switching it off from a linked plot clears it everywhere;
  `getConfig()` returns `locked` and `update()` restores it.

Part 5 (menu):

- A right-click in the plot area opens a full menu with a row per 2D axis; a
  right-click on an axis strip opens that axis's row only.
- Toggling Axis/Labels/Title sets the config key and reflows the margin; toggling
  Lock calls `setAxisLocked` and rebuilds no layers; Reset view calls
  `resetAxes()`.
- A hidden axis's Labels/Title boxes are disabled and keep their state; Lock stays
  live and shows a lock held by a linked plot.
- Any menu toggle emits `'menuchange'` once; an injected host item renders and
  emits `'menuchange'` on toggle.
- Escape / outside-click / Reset view close the menu.

## Order and releases

Builds on #37 (the polygon's right press) and #38 (`_layoutMargin()`), and
touches `Axis.js`, which #36 also changes. Opened once those three are merged, or
stacked on them. Whether it ships in the same release as #36–#38 is the
maintainer's call; one release keeps a consumer to a single bump.

## Not in this plan

- Touch long-press; a Mac Ctrl+click as a right-click.
- A right-click on a color bar or filter bar; color/filter axes in the menu.
- A lock on color and filter axes.
- Axis rows, reset and the lock mark on 3D plots; a 3D plot only obeys a lock set
  on a linked 2D axis.
- Per-plot margins.
- App-specific menu items (e.g. a status bar) — those come through the hook from
  the host, along with the host's persistence; a reset that keeps following the
  data line to line.

## Implementation steps

1. Parts 1–4: the three axis keys, the pixel layout + margin rule, the
   `'contextmenu'` event with the axis it was on, `resetAxes()`, the range lock
   and its mark; tests and docs.
2. Part 5: the menu widget (rows, checkboxes, context-sensitivity, grey-out,
   positioning), the `'menuchange'` event and the item hook; tests and docs.
3. A release (maintainer's step).

One PR to `redhog/gladly`. About a day and a half for Parts 1–4 (most of it the
pixel layout, the lock and their tests) and about half a day for Part 5.
