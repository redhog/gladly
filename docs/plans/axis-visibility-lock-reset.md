# Plan: Axis parts, range lock, reset (axis-config features)

## Overview

Three gladly features, each driven by a key in `axes.<slot>`:

- hide an axis's **tick labels** or its **title** on their own — separately from
  hiding the whole axis — and give the freed margin back;
- **lock** an axis's range so it survives zoom/scroll/pan and a reset until
  switched off;
- **reset** the view to the data range.

This plan carries **no UI**. The right-click menu that lets a user toggle these
keys is a separate plan — `docs/plans/axis-context-menu.md` — stacked on top of
this one. The point of the split is that everything here is pure gladly
data-model and rendering, reusable by any consumer that writes config, and
testable without a menu.

**PR stack:** builds on open PRs #36 (typed axis limits, which also touches
`Axis.js`) and #38 (`marginWithoutAxis`). The lock and reset do not need #37.

## Single source of truth — axis state lives in `axes.<slot>` only

The governing rule for this plan and the menu plan that follows:

> Every axis setting — `tickLabelsVisible`, `titleVisible`, `locked` — is a key
> in `axes.<slot>`. Nothing is stored on the `Axis` object, at plot level, or in
> any menu/widget state.

This is cheap because of how config already works (verified against the code):

- `Axis` is thin. It reads `visible` and `label` **live** from
  `this._plot.currentConfig.axes[this._name]` at render time
  (`src/axes/Axis.js`, `prepareAtlas`/`render`); it holds no config of its own and
  has no `getConfig()`/`toJSON()`.
- `plot.getConfig()` (`src/core/Plot.js`) rebuilds the `axes` block by **spreading
  whatever is already in `currentConfig.axes[slot]`** (`...(axes[axisId] ?? {})`).
  So any new key dropped into `axes.<slot>` round-trips through `getConfig()` with
  **no new serialization code**, and a consumer that stores `plot.getConfig()`
  keeps it for free.
- Therefore the only obligation on this plan is: whoever changes a setting writes
  it into `currentConfig.axes[slot]`. `setAxisLocked()` writes `locked` there; the
  visibility toggles (driven later by the menu) write their keys there. Nothing
  else is needed for persistence.

(Precedent / caution: `rotate` is already a declared axis key that is **never
read** — title rotation is hard-coded in `Axis.render`. Our new keys must actually
be read, not merely declared.)

## What exists

Read against master at `1e1c983` with #36, #38 applied.

- `axes.<slot>.visible: false` hides an axis whole: `Axis.prepareAtlas()` and
  `Axis.render()` return early (`src/axes/Axis.js`). There is no switch for the
  tick labels alone or the title alone. The title is `axes.<slot>.label`, falling
  back to the quantity kind's label; an empty `label` already draws no title, but
  the text is then lost and no room is freed.
- In 2D the tick marks, tick labels and title sit at fixed fractions of the
  axis-to-edge distance (0.12, 0.40, 0.75 of the margin). This is why a side
  cannot shrink below ~48 px (x) / ~80 px (y) without collisions.
- #38: a side's margin is `margin[side]` when it draws an axis and
  `marginWithoutAxis[side]` when it draws none (including a `visible: false`
  axis). `_layoutMargin()` recomputes on every `update()`. A 3D plot keeps
  `margin` on every side.
- Linked axes (`linkAxes`) pass a domain on in `Axis.setDomain()`. Auto-fit
  (`AxisRegistry.applyAutoDomainsFromLayers`) computes each quantity kind's data
  range but keeps it (`dataExtent`) only for filter axes, and sets domains
  without going through `Axis.setDomain()`, so a refit does not reach linked
  plots. A slot's config `min`/`max` win over the data range; a quantity kind
  with no range falls back to 0..1.
- Every zoom/pan gesture ends in `Axis.setDomain()`, called by `ZoomController`
  once per axis it moves; a gesture on an axis strip moves that axis only, one in
  the plot area moves every axis.
- `ZoomController._getRegion2D()` works out which axis strip a point is in (an
  axis hidden with `visible: false` counted too); a corner or an empty margin is
  in no region. #36 uses it for the limit boxes.
- gladly already renders floating DOM widgets over the canvas (`floats/Float.js`)
  and marks interactive DOM with `data-gladly-control` (#36's limit boxes).

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
when its key is `false` (read live, same path as `visible`/`label`). The three
switches are independent; a title with no labels is possible though rarely
wanted. Works on 3D plots too (margins there do not change).

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

## Part 2: Range lock

### Motivation

Pin an axis's range for a review so it survives zoom/scroll/pan on any plot, and a
reset, until switched off.

### State and API

A `locked` key in each `axes.<slot>`, default `false`, read into the axis at
`update()` and returned by `getConfig()` (via the central spread — no extra code).

- `plot.isAxisLocked(slot)` → true when the slot holds the lock, when an axis
  reached through `_linkedAxes` (followed with a visited set) holds it, or when
  another slot of the same plot with the same quantity kind holds it. This is a
  **derived read**; the stored truth is the per-slot `locked` key.
- `plot.setAxisLocked(slot, on)` → writes `locked` into
  `currentConfig.axes[slot]` (on that slot when setting; clears it on every axis
  `isAxisLocked` looks at when unsetting), then **renders again without
  `update()`** (no layer rebuild). Because it writes config, the change
  round-trips through `getConfig()` with no further work.

### Enforcement

`ZoomController`'s drag, wheel and touch handlers **skip a locked axis before
calling `setDomain()`** (reading the lock live, via `isAxisLocked`), so the free
axes of the same gesture still move. A gesture in the plot area of a plot with x
locked and y free moves y only. Covers 3D plots, which obey a lock set on a
linked 2D axis.

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
every plot, with a "locked" tooltip. A hidden axis draws no mark (its lock still
shows in the menu — Plan B). Where the mark sits when the title is hidden is for
the review. Display-only; the toggle lives in the menu plan.

## Part 3: Reset

`plot.resetAxes()` sets each 2D spatial axis that has a scale to its data range
through `Axis.setDomain()`, so linked axes in other plots follow and nothing else
moves. It keeps a reversed axis reversed and a log axis above zero, as auto-fit
does. Needs `applyAutoDomainsFromLayers()` to keep `dataExtent` for **every**
quantity kind, not only filter axes. Color and filter axes are left alone;
locked axes are skipped. On a 3D plot it does nothing.

## Docs

- `docs/user-api/Plot.md`: `resetAxes()`, `isAxisLocked()`, `setAxisLocked()`.
- `docs/configuration/PlotConfiguration.md`: `tickLabelsVisible`, `titleVisible`,
  `locked` as `axes.<slot>` keys; the margin rule; what a lock stops and what it
  does not; the note that all three round-trip through `getConfig()`.
- `docs/architecture/`: where the 2D axis pixel layout is described.

## Tests (web-test-runner, `test/`)

- A hidden title or tick labels draw nothing of that part.
- Each hidden part narrows its side by its band; no side goes below
  `marginWithoutAxis`; a plot that hides nothing keeps #38's margins.
- `resetAxes()` sets the data range on a zoomed axis, keeps a reversed axis
  reversed, refuses zero on a log axis, moves a linked axis on a second plot and
  leaves its unlinked axis alone.
- Lock: a locked axis ignores wheel, drag and touch; so does an axis linked to it
  on a second plot, and one linked through a third; a wheel in the plot area of a
  plot with x locked moves y only; a typed limit moves a locked axis and its
  linked axes; `setDomain()` still moves a locked axis; `resetAxes()` leaves a
  locked axis; switching it off from a linked plot clears it everywhere.
- Config round-trip: setting `tickLabelsVisible`/`titleVisible`/`locked` and
  calling `getConfig()` returns them, and `update()` restores them.

## Order and releases

Builds on #38 (`_layoutMargin()`) and touches `Axis.js`, which #36 also changes.
Opened once those are merged, or stacked on them. The menu plan
(`axis-context-menu.md`) stacks on this one.

## Not in this plan

- The right-click menu, the `'contextmenu'` event — those are `axis-context-menu.md`.
- A lock/reset on color and filter axes.
- Axis rows, reset and the lock mark on 3D plots; a 3D plot only obeys a lock set
  on a linked 2D axis.
- Per-plot margins.

## Implementation steps

1. The three axis keys (`tickLabelsVisible`, `titleVisible`, `locked`), the pixel
   layout + margin rule, `isAxisLocked`/`setAxisLocked` + ZoomController
   enforcement + the lock mark, `resetAxes()` + `dataExtent`; tests and docs.
2. A release (maintainer's step), or stacked under the menu plan.

One PR to `redhog/gladly`. About a day (most of it the pixel layout, the lock and
their tests).
