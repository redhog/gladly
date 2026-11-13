# Plan: Axis parts, range lock, reset (axis-config features)

## Overview

Three gladly features, each driven by a key in `axes.<slot>`:

- hide an axis's **tick labels** or its **title** on their own — separately from
  hiding the whole axis — and give the freed margin back;
- **lock** an axis's range so it survives zoom/scroll/pan and a reset until
  switched off;
- **reset** the view to the data range.

This plan carries **almost no UI**. The one exception is a single direct
affordance: **clicking an axis title toggles that axis's lock** (Part 2). It is
included here because the lock mark it toggles is already drawn here, and because
a title click is a self-contained interaction that does not need any menu
machinery. The fuller right-click menu that toggles *every* key on these axes is
still a separate plan — `docs/plans/axis-context-menu.md` — stacked on top of
this one. The point of the split is that everything here is pure gladly
data-model and rendering plus that one toggle, reusable by any consumer that
writes config, and testable without a menu.

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

### Per-axis config/schema accessors on `Axis`

`Axis` gains three methods that are the per-axis counterparts of the existing
`Plot` methods, scoped to just this axis's slice:

| `Axis` method | `Plot` counterpart | returns / does |
|---|---|---|
| `axis.getConfig()` | `plot.getConfig()` | the **merged** per-slot config for this axis — identical to `plot.getConfig().axes[slot]`, not the raw `currentConfig.axes[slot]` override slice. It is **defined in terms of** the same per-slot merge `plot.getConfig()` builds (`{...qkDef, ...currentConfig.axes[slot], ...liveMinMax, ...quantity_kind}`, `Plot.js:313-326`), so every key — the stored overrides, the live domain, and the new ones — round-trips for free. See the shared-merge note below |
| `axis.setConfig(cfg)` | `plot.update({ config })` | writes `cfg` as this axis's `axes.<slot>` object and re-applies through the plot's normal config path so every key (`min`/`max`/`scale`/`quantity_kind`/the visibility + `locked` keys) takes effect |
| `Axis.schema()` *(static)* | `Plot.schema(data, config)` *(static)* | the JSON Schema fragment that governs one axis config — `Plot.schema(...).properties.axes.additionalProperties`. Because the plot schema describes all slots with a single `additionalProperties` schema, this fragment is the same for every axis; it is exactly what a menu/editor validates a slot against. **Static and takes no arguments** — see below |

Naming notes — the governing rule is that a **`get`/`set` prefix denotes live
instance-state access**:

- `getConfig`/`setConfig` **read and write the live per-slot config on the
  instance**, so the prefix is warranted — and it matches `plot.getConfig()`, which
  carries it for the same reason.
- `schema()` is a **pure static value** — no instance to read from — so it takes no
  prefix, matching `Plot.schema()`.

That rule is also where the mirror stops being letter-perfect; the two deviations
below are called out so the implementer picks deliberately:

- `getConfig` matches `plot.getConfig()` exactly.
- `Plot` has no `setConfig` — a plot's config is applied via `plot.update({ config })`.
  `axis.setConfig()` is the per-axis name for that operation; it still goes through
  the plot's update path internally. (It is heavier than `setAxisLocked()`'s
  render-only fast path, which stays the lightweight special case for the single
  key it owns.)
- The schema accessor is **static `Axis.schema()`**, mirroring the static
  `Plot.schema()` exactly — same name (no `get` prefix; `Plot` does not use one),
  same static-ness. No `get` is invented where `Plot` has none.
- `Axis.schema()` takes **no arguments**, unlike `Plot.schema(data, config)`.
  `data` and `config` only shape the plot schema's **layers / transforms /
  computation** parts (column names, computed columns, transform outputs); the
  `axes.additionalProperties` fragment this method returns depends on neither — its
  only dynamic piece is the `colorscale` enum, which comes from the **global**
  colorscale registries. It is static (not an instance method) because the fragment
  is identical for every axis and needs no instance, plot, data or config.

These are thin, derived accessors over the single source of truth; they store no
state of their own.

**Shared-merge note (governing invariant).** There are two sources behind an
axis: the stored sparse override `currentConfig.axes[slot]`, and the live
`AxisRegistry` runtime state (the D3 scale's domain and the slot→quantity-kind
binding). `currentConfig.axes[slot]` is **not** the resolved config — it is only
the override overlay; `plot.getConfig()` is the single place the two are
reconciled, layering `{...qkDef, ...currentConfig.axes[slot], ...liveMinMax,
...quantity_kind}` per live-scaled slot (`Plot.js:313-326`). Therefore
`axis.getConfig()` must return that **merged** object, not the raw override — the
invariant is:

```js
plot.getConfig().axes[slot]  ===  plot.axes[slot].getConfig()   // deep-equal
```

Implement it by factoring the per-slot merge out of the `getConfig()` loop into a
helper (e.g. `plot._axisConfig(slot)`) that both call: `plot.getConfig()` loops it
over every live slot, `axis.getConfig()` returns `plot._axisConfig(this._name)`.
The equivalence is then true by construction, not by luck. (`axis2d` mirrors this:
`Axis2d.getConfig()` is defined as the pair's entry inside
`plot.getConfig().colorbars` — see `axis2d-object.md`.)

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
from the axis line instead of fractions of the margin. The three bands are:

- **Tick band** — a drawn line, genuinely fixed at ~6 px.
- **Label band** — the actual rendered label height plus a small gap. Tick labels
  start ~2 px past the ticks: x labels centred on their tick with the near edge
  there; y labels aligned on that edge, using each label's width from the atlas.
- **Title band** — the actual rendered title height (× its line count) plus a gap,
  at the outer margin edge.

The label- and title-band sizes are **read from the atlas**, not hard-coded. The
atlas already stores the pixel size of every string it rendered — `Axis.js` reads
`entry.pw`/`entry.ph` per label and per title line today. Deriving the bands from
those metrics makes the layout correct at any font size automatically, instead of
pinning it to a 16 px assumption that silently breaks (labels collide or leave
gaps) if the font changes. The px figures below are the *expected values at the
current font*, not constants in the code.

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

The lock is **local to one plot**. It never propagates across `linkAxes` and never
consults another plot. The only grouping it honours is *within the same plot*: slots
that share a quantity kind are one axis to the user (they share a domain), so they
share one lock.

- `plot.isAxisLocked(slot)` → true when the slot holds the lock, or when another
  slot **of the same plot** with the same quantity kind holds it. It does **not**
  follow `_linkedAxes`. This is a **derived read**; the stored truth is the per-slot
  `locked` key.
- `plot.setAxisLocked(slot, on)` → writes `locked` into `currentConfig.axes[slot]`
  — setting it on the slot when turning on, clearing it on the slot and every
  same-QK sibling **of this plot** when turning off — then **renders again without
  `update()`** (no layer rebuild). It touches only this plot's config. Because it
  writes config, the change round-trips through `getConfig()` with no further work.

### Enforcement

`ZoomController`'s mouse-drag, touch-drag, touch-zoom and wheel loops **skip a
locked axis before calling `setDomain()`** (reading the lock live, via
`isAxisLocked`), so the free axes of the same gesture still move. A gesture in the
plot area of a plot with x locked and y free moves y only. Because `region.axes` is
built the same way in 2D (`_getRegion2D`) and 3D (`_getRegion3D`), this covers 3D
plots directly — a 3D axis is locked exactly as a 2D one. 3D **rotation** never
calls `setDomain()` (it only moves the camera), so it is untouched by locks:
rotation is not an axis and cannot be locked.

The lock is purely local and purely a gesture guard upstream of `setDomain()`. It
adds nothing to `Axis.setDomain()`, `AxisLink`, `AxisLimitEditor` or `update()`.
(Part 3 does extend `setDomain()` with a `null`-means-data case, but that is
orthogonal: a locked axis is simply skipped by `resetAxes()` and never receives the
`null`.) Therefore every non-gesture domain change still moves a locked axis:

- A typed limit (#36) **still moves** it (typing is deliberate); the lock stays on.
  #36 needs no change.
- A programmatic `setDomain()` **still moves** it. A test pins this.
- A domain pushed from a **linked plot still moves** it: a link push arrives through
  `setDomain()` and is, by design, identical to a programmatic update. The lock does
  not propagate across links and does not block a link push — the other plot's axis
  is free, moves, and its push lands here like any other `setDomain()`. A test pins
  this (a locked axis still receives a linked plot's zoom).
- The fit to data never reaches a locked axis anyway (its config `min`/`max` win).

### Lock mark

Two visual cues on a locked axis, both reading `isAxisLocked` live, on 2D and 3D:

- **Red axis line.** The axis line itself is drawn red instead of black when locked
  (`Axis.render` draws the line `[0,0,0,1]` today → red when `isAxisLocked`). This
  is the cue that always shows: it is independent of the title and the tick labels,
  so it survives `titleVisible: false` and `tickLabelsVisible: false`. A
  whole-hidden axis (`visible: false`) draws no line and therefore no cue (its lock
  still shows in the menu — the menu plan).
- **Lock glyph.** A small lock glyph beside the title, with a "locked" tooltip,
  drawn only where the title is drawn. When the title is hidden (`titleVisible:
  false`) or the axis is whole-hidden, the glyph is hidden too — this is purely
  visual and does **not** change the lock state; the red line still shows.

The cues reflect state; the toggle is the title click below. (With the title
hidden there is no title to click, so toggling then goes through the menu or
`setAxisLocked()` — the red line still marks the axis as locked.)

### Click-to-toggle

**Clicking an axis title toggles that axis's lock** — a plain click calls
`plot.setAxisLocked(slot, !plot.isAxisLocked(slot))`, which re-renders the mark
without an `update()`. Works on 2D and 3D axes.

Detecting the target (the title is a WebGL atlas billboard, not a DOM element, so
there is no DOM hit target — the handler goes through `ZoomController`, which
already maps a point to an axis):

- **2D**: `_getRegion2D()` gives the axis strip, and the title's pixel band is a
  **known rectangle** per side from Part 1's fixed-pixel layout. A point in the
  title band of a side whose title is drawn (not `titleVisible: false`, not a
  whole-hidden axis) hits that axis's title.
- **3D**: there is no fixed band, but `_getRegion3D()` already resolves a point to
  its nearest axis, and the title sits at that axis's outward far end. A click
  resolved to an axis, within the projected title region at that end, hits that
  axis's title.
- **Both**: a mousedown on an axis strip today **starts a zoom/pan gesture on that
  axis**. So the toggle fires on a **click** — mousedown then mouseup with no
  movement past a small threshold — and a drag past the threshold is left to the
  existing zoom/pan (pan in 2D and on a 3D axis; rotation when the 3D gesture is a
  rotate). The lock is toggled on mouseup, not mousedown, so a drag that happens to
  begin in the title region still pans/rotates.
- A locked axis cannot be dragged anyway (Part 2's enforcement), so in practice a
  press on a locked title only ever resolves to a click → unlock.
- This is a single click. #36's double-click-on-axis-**end** (type a limit) sits
  at the axis ends, not the title band, and keys off a different event; the two do
  not overlap.

The title click is the only pointer interaction this plan adds. Toggling the
other keys (`tickLabelsVisible`, `titleVisible`) stays with the menu plan.

## Part 3: Reset

### `setDomain(null)` means "the data range"

Reset is not a separate code path. `Axis.setDomain(domain)` gains one case: a
`null` (or absent) `domain` means **reset this axis to its data range**.
`setDomain` resolves the marker to concrete numbers *at the entry point* — it
looks up the data extent for this axis's quantity kind and then behaves exactly
as a normal `setDomain([min, max])` from there. Resolved numbers (never the
marker) are what propagate to listeners and linked axes, because a linked plot
has its own data and must receive this axis's resolved range, not re-resolve the
marker against its own.

Resolution reads `axisRegistry.getDataExtent(qk)`, which already exists but today
is only populated for filter axes. So reset needs `applyAutoDomainsFromLayers()`
to keep `dataExtent` for **every** quantity kind, not only filter axes — the one
real change. It keeps a reversed axis reversed and a log axis above zero, as
auto-fit does.

This gives per-axis reset for free (`axis.setDomain(null)`), and it reuses the
existing link-propagation path with no new code.

### `plot.resetAxes()`

A thin convenience over the above: it loops the 2D spatial axes that have a scale
and calls `setDomain(null)` on each. Color and filter axes are left alone; locked
axes are skipped. On a 3D plot it does nothing.

## Docs

- `docs/user-api/Plot.md`: `resetAxes()`, `isAxisLocked()`, `setAxisLocked()` —
  noting the lock is local to one plot and groups only same-QK slots of that plot.
- `docs/user-api/Axis.md` (or wherever `setDomain` is documented): `setDomain(null)`
  resets the axis to its data range and propagates to linked axes; `getConfig()`,
  `setConfig(cfg)` and the static `Axis.schema()` as the per-axis counterparts of
  `plot.getConfig()`, `plot.update({config})` and the static `Plot.schema()`.
- `docs/configuration/PlotConfiguration.md`: `tickLabelsVisible`, `titleVisible`,
  `locked` as `axes.<slot>` keys; the margin rule; what a lock stops and what it
  does not (it blocks gestures only, is local to one plot, and does not propagate
  across links); that clicking an axis title (2D or 3D) toggles its lock; the note
  that all three round-trip through `getConfig()`.
- `docs/architecture/`: where the 2D axis pixel layout is described.

## Tests (web-test-runner, `test/`)

- A hidden title or tick labels draw nothing of that part.
- Each hidden part narrows its side by its band; no side goes below
  `marginWithoutAxis`; a plot that hides nothing keeps #38's margins.
- `setDomain(null)` sets the data range on a zoomed axis and propagates the
  resolved numeric range (not the marker) to a linked axis on a second plot.
- `resetAxes()` sets the data range on a zoomed axis, keeps a reversed axis
  reversed, refuses zero on a log axis, moves a linked axis on a second plot and
  leaves its unlinked axis alone.
- Lock: a locked axis ignores wheel, drag and touch on its strip and in the plot
  area; a wheel in the plot area of a plot with x locked moves y only; locking one
  slot locks every same-QK slot of the **same** plot (grabbing a sibling strip does
  not move the locked axis); the lock does **not** propagate to a linked plot — the
  linked plot's same axis is still draggable, and its push **does** move the locked
  axis (a link push is a programmatic update); a typed limit moves a locked axis;
  `setDomain()` still moves a locked axis; `resetAxes()` leaves a locked axis;
  turning it off clears it across the same-QK slots of that plot.
- Lock in 3D: a locked 3D axis ignores drag, wheel and touch; rotation still works
  while an axis is locked.
- Lock cues: a locked axis draws its line red, and the red line persists with
  `titleVisible: false` and with `tickLabelsVisible: false`; the lock glyph shows
  with the title drawn and is gone when the title is hidden, without changing the
  lock state; a whole-hidden axis draws neither cue.
- Title click: a click in a 2D axis's title band toggles its lock (off→on and
  on→off); a click in the title band of a hidden title does nothing; a drag that
  starts in the title band pans/zooms instead of toggling; a click on one axis's
  title does not lock another; a click on a 3D axis's title toggles its lock, and a
  rotation drag starting there rotates instead.
- Config round-trip: setting `tickLabelsVisible`/`titleVisible`/`locked` and
  calling `getConfig()` returns them, and `update()` restores them.
- Per-axis accessors: `plot.axes[slot].getConfig()` **deep-equals**
  `plot.getConfig().axes[slot]` (the governing invariant — the merged per-slot
  config, not the raw `currentConfig.axes[slot]` override); `axis.setConfig({min,
  max})` applies and `axis.getConfig()` reflects it; `Axis.schema()` equals
  `Plot.schema(data, config).properties.axes.additionalProperties` and validates a
  slot config.

## Order and releases

Builds on #38 (`_layoutMargin()`) and touches `Axis.js`, which #36 also changes.
Opened once those are merged, or stacked on them. The menu plan
(`axis-context-menu.md`) stacks on this one.

## Not in this plan

- The right-click menu, the `'contextmenu'` event — those are `axis-context-menu.md`.
- A lock/reset on color and filter axes.
- Reset and the axis-part margin changes on 3D plots (3D margins do not change); a
  3D axis **can** be locked and shows a lock mark, but reset stays 2D-only.
- Cross-plot propagation of the lock: a lock is local to one plot.
- Per-plot margins.

## Implementation steps

1. The three axis keys (`tickLabelsVisible`, `titleVisible`, `locked`), the pixel
   layout + margin rule, `isAxisLocked`/`setAxisLocked` + ZoomController
   enforcement + the lock mark + the title-click toggle, `setDomain(null)` +
   `resetAxes()` + `dataExtent`, the `Axis` `getConfig`/`setConfig` accessors +
   static `Axis.schema()`; tests and docs.
2. A release (maintainer's step), or stacked under the menu plan.

One PR to `redhog/gladly`. About a day (most of it the pixel layout, the lock and
their tests).
