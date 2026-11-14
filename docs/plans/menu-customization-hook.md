# Plan: Customize the axis / plot right-click menu via a `'contextmenu_open'` event

## Overview

Let a consumer customize gladly's built-in right-click menu (both the full plot
menu and the single-axis menu — they are one `AxisMenu` widget) by registering a
JS callback that receives the **fully-built menu DOM element** just before the
menu is shown. The callback mutates the element in place: append rows or buttons,
attach event handlers, remove or restyle the items gladly put there.

This is delivered as a new synthetic event, `plot.on('contextmenu_open', cb)`,
parallel to the existing `'contextmenu'` event. Its callback mirrors
`'contextmenu'`'s parameters exactly — `(e, coords, region)` — and appends one
extra argument, the menu element: `(e, coords, region, menuEl)`. It augments the
built-in menu; it does not replace it.

## What exists

Read against `master` (`585acc2`).

- **`src/floats/AxisMenu.js`** — the built-in menu. `open(clientX, clientY, region)`:
  1. resolves `slots` (one axis strip, or every spatial axis) via `_slotsFor(region)`;
  2. builds a `<div>` `el` with `data-gladly-control="axis-menu"`, appends the
     spatial table, the (plot-wide) colour/filter table, and the Reset button;
  3. `document.body.appendChild(el)`, sets `this._el = el`;
  4. `this._refresh()` (runs every registered refresher — re-reads live config into
     each control);
  5. `this._place(clientX, clientY)` (measures `el.offsetWidth/Height`, clamps into
     the viewport).
  Each control wires its own `change`/`click` handler that writes an `axes.<slot>`
  key through `plot.update()`; the menu holds no state of its own.
- **`src/core/Plot.js`**
  - `_emitContextMenu(e, region)` (≈line 1353): fires every `'contextmenu'`
    listener with `(e, coords, region)`, then, when the gate (`axis_menu` for an
    axis strip, else `plot_menu`) is not `false`, calls
    `this._axisMenu.open(e.clientX, e.clientY, region)`.
  - `on(eventType, callback)` (≈line 1408): the public event registrar. Synthetic
    types (`'error'`, `'no-error'`, `'axislimit'`, `'axisoptions'`, `'contextmenu'`)
    each keep a `Set` of listeners and return `{ remove }`; anything else falls
    through to a real DOM capture listener. `'contextmenu'` listeners live in
    `this._contextMenuListeners` (created in the constructor ≈line 249, cleared in
    `destroy()` ≈line 1079).
  - `axis_menu` / `plot_menu` config booleans (schema ≈lines 68–77) gate whether the
    built-in menu opens at all. When one is `false`, the built-in menu does not open
    for that region and `'contextmenu'` still fires — the existing path for building
    a menu entirely from scratch.
- The `AxisMenu` instance is created lazily in `Plot` (`if (!this._axisMenu) this._axisMenu = new AxisMenu(this)`, ≈line 547) and holds a back-reference to the plot.

## Design

**Registration.** A new synthetic event type `'contextmenu_open'`, registered the
same way as `'contextmenu'`:

```js
const handle = plot.on('contextmenu_open', (e, coords, region, menuEl) => { … })
// handle.remove() to unregister
```

Multiple listeners are supported (a `Set`), each called in turn; an exception in
one is caught and logged
(`console.error('[gladly] Error in contextmenu_open listener:', err)`) and does
not block the others or the menu — matching the existing `'contextmenu'` error
handling.

**Callback signature.** `cb(e, coords, region, menuEl)` — the first three
parameters are **exactly** those of the existing `'contextmenu'` event; `menuEl`
is the only addition:

- `e` — the originating pointer event (same object `'contextmenu'` receives).
- `coords` — `plot.lookup(...)`'s per-axis value map at the press point (same as
  `'contextmenu'`).
- `region` — the `{ type, axes }` region the right-click resolved to, or `null`
  for a corner / empty margin (same as `'contextmenu'`). This already encodes
  **which menu**: `region?.type === 'axis'` is the single-axis menu and
  `region.axes[0]` is the axis slot it acts on (e.g. `'xaxis_bottom'`,
  `'yaxis_right'`); `region` plot-area/`null` is the full plot menu.
- `menuEl` — the menu's root `<div>` (the `data-gladly-control="axis-menu"`
  element), already attached to `document.body` and already refreshed, so
  mutations and measurements are live.

Everything a consumer needs to identify the menu is already in `region`, so no
extra `slots` / `singleAxis` / `plot` / `close` fields are passed — the listener
is registered through `plot.on(...)`, so `plot` is already in its closure, and
`region` supplies the axis identity. (To map a slot to its displayed title or
quantity kind, use `plot.currentConfig?.axes?.[slot]?.label` and
`plot.axisRegistry?.getQkForSlot(slot)`, the same sources `AxisMenu._rowTitle()`
uses.)

**Timing.** The event fires inside `AxisMenu.open`, **after** `this._refresh()` and
**before** `this._place(...)`. Rationale:
- after append + refresh → the DOM is complete and in the document, so the callback
  can read computed sizes and the built-in controls already show their live values;
- before place → `_place` measures `el.offsetWidth/Height` after the callback has
  added/removed content, so the menu is positioned at its final size and stays in
  the viewport.

**Scope.** Augment-only. The callback gets the real element and may add, remove,
restyle, or re-wire anything in it. Building a menu from nothing remains the job of
the `'contextmenu'` event with `plot_menu` / `axis_menu` set to `false`; `'menu'`
only fires when the built-in menu actually opens.

**Interop notes for the callback author** (documented, not enforced):
- Mark any interactive DOM you add with `data-gladly-control` on an ancestor, or
  it won't matter here (the menu's own outside-press/`mousedown` handling lives on
  `el` and already covers descendants), but it does matter for `plot.on(domEvent,…)`
  consumers who skip `[data-gladly-control]` targets. Added controls inside `menuEl`
  are inside the menu's chrome, so a press on them already does not close the menu
  unless it's an `INPUT`/`SELECT`/`OPTION` (see `el`'s `mousedown` guard).
- The menu is rebuilt on every open, so the callback runs every time; it must not
  assume it runs once.
- gladly's refresher system (`this._refreshers`) is internal; added controls are
  not refreshed by gladly. A callback that needs live-updating controls manages its
  own state (same as any `'contextmenu'`-built menu).

## Changes

1. **`src/core/Plot.js`**
   - Constructor: add `this._contextMenuOpenListeners = new Set()` next to
     `_contextMenuListeners`.
   - `destroy()`: add `this._contextMenuOpenListeners.clear()`.
   - `on()`: add a `'contextmenu_open'` branch mirroring `'contextmenu'` —
     `this._contextMenuOpenListeners.add(callback); return { remove: () => this._contextMenuOpenListeners.delete(callback) }`.
   - Add a small internal emitter used by `AxisMenu`:
     ```js
     _emitContextMenuOpen(e, coords, region, menuEl) {
       for (const cb of this._contextMenuOpenListeners) {
         try { cb(e, coords, region, menuEl) }
         catch (err) { console.error('[gladly] Error in contextmenu_open listener:', err) }
       }
     }
     ```
   - `_emitContextMenu(e, region)`: it already computes `coords`. Pass `e` and
     `coords` through to the menu so the menu can echo them to
     `_emitContextMenuOpen` — change the open call to
     `this._axisMenu.open(e, coords, region)` (see change 2 for the new signature).

2. **`src/floats/AxisMenu.js`**
   - Change `open(clientX, clientY, region)` → `open(e, coords, region)`; derive
     the placement coordinates from the event (`e.clientX`, `e.clientY`) where
     `_place(...)` is currently called. (The sole caller is `_emitContextMenu`.)
   - In `open()`, between `this._refresh()` and `this._place(...)`:
     ```js
     this._plot._emitContextMenuOpen(e, coords, region, el)
     ```

3. **Docs**
   - `docs/user-api/Plot.md` — add `'contextmenu_open'` to the events the
     `on(eventType, callback)` section documents, with the full
     `cb(e, coords, region, menuEl)` signature, a note that its first three
     parameters mirror `'contextmenu'`, that `region` identifies which menu/axis,
     and the `'contextmenu_open'` (augment the built-in menu) vs `'contextmenu'`
     (fires before, build-your-own) distinction.
   - CLAUDE.md's `AxisMenu.js` one-liner (`floats/AxisMenu.js`) — mention it emits
     the `'contextmenu_open'` event for customization.

## Out of scope

- No config key (a function is not serializable config; `axis_menu` / `plot_menu`
  stay booleans).
- No "take over / suppress built-in" return value — that is already covered by
  disabling the built-in menu and using `'contextmenu'`.
- No new refresher/registration hooks for consumer-added controls — callbacks own
  their state.

## Test / verify (manual, in the example)

- `plot.on('contextmenu_open', (e, coords, region, el) => { … append a button … })`
  adds the button to both the full and single-axis menus;
  `region?.type === 'axis'` distinguishes them and `region.axes[0]` names the axis;
  the menu is still placed fully inside the viewport after the addition.
- The first three args match a sibling `plot.on('contextmenu', …)` listener's args
  for the same press.
- Throwing inside the callback logs `[gladly] Error in contextmenu_open listener:`
  and the menu still opens.
- With `plot_menu: false`, `'contextmenu_open'` does not fire for a plot-area
  right-click (no built-in menu opens) but `'contextmenu'` still does.
- `handle.remove()` stops further invocations.
