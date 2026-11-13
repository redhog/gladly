# Plan: `axis2d` — a first-class object for 2D colour pairings

## Overview

A 2D colour map in gladly pairs two colour axes and colours data from the pair
(`map_color_s_2d` takes the true-2D branch when both axes carry the **same** 2D
colorscale — negative index, `cs_a == cs_b`, `ColorscaleRegistry.js:255`). Today
that pairing is controlled only through loose config:

- the **structural** pair is declared by a layer (`layer.colorAxes2d`, from
  `colorAxis2dQuantityKinds`; `Layer.js:49-51`, `LayerType.js:379,504`;
  ScatterShared auto-builds `{'': ['', '2']}` when a layer has two colour
  attributes, `ScatterShared.js:30`);
- the **colorscale + widget** come from a `currentConfig.colorbars[]` entry, which
  on `update()` both overrides each member axis's colorscale (`ensureColorAxis`,
  `Plot.js:415-419` → `AxisRegistry.js:149-152`) **and** creates the colorbar2d
  Float (`_syncFloats`, `Plot.js:796-811`).

This plan adds a first-class handle — **`plot.axis2d[pair]`** — that is to a 2D
pairing what `plot.axes[name]` is to a single axis: a stable object with
`getConfig()`, `setConfig()`, and a static `schema()`. Its config **is** the
pair's `colorbars[]` entry. The entry gains two booleans so the pairing and its
float can each be turned off independently.

**Relation to the axis accessors:** mirrors the `Axis` `getConfig`/`setConfig` +
static `Axis.schema()` work in `axis-visibility-lock-reset.md`. Same naming rule:
a `get`/`set` prefix denotes live instance-state access (`getConfig`/`setConfig`);
the pure static schema value is `schema()`, no prefix.

## Scope

- **2D entries only.** `axis2d` covers the 2D (`{xAxis, yAxis}`) colorbars
  entries. 1D colorbars entries are out (see "1D entries" below).
- **Pairs are defined by layers.** The set of `axis2d` keys is exactly the set of
  2D pairs the layers fuse via `colorAxes2d`. A pairing is meaningful iff a layer
  backs it — the same way `plot.axes[name]` is inert until a layer gives that axis
  a scale (`Axis.render` bails when `getScale` is null, `Axis.js:198`). `axis2d`
  is the 2D analog, not a parallel registry.

## State and config

A 2D pairing's config is its `colorbars[]` entry:

```
{ xAxis: <qkX>, yAxis: <qkY>, colorscale: <2d-colorscale-name>,
  enabled: true, colorbar: true }
```

Two **new** keys on the entry (schema `Plot.js:126-145`):

| key | default | effect |
|---|---|---|
| `enabled` | `true` | when `false`, the entry does **not** override its member axes' colorscales — the pair reverts to each axis's own colorscale, so no forced 2D colouring. Gates the `ensureColorAxis` override (`Plot.js:415-419`). |
| `colorbar` | `true` | when `false`, the colorbar2d Float is not drawn. Gates float creation in `_syncFloats` (`Plot.js:798-801`). |

**No entry ≡ `enabled:false`.** A layer-defined pair with no `colorbars[]` entry,
and a pair whose entry sets `enabled:false`, are the **same state**: neither
overrides the member axes, so both colour from each axis's own colorscale. So
`getConfig()` returning `{}` (no entry) and `getConfig()` returning
`{enabled:false}` mean the same thing — "use the individual axes." Creating an
entry (default `enabled:true`) is what turns the forced 2D pairing on.

The two booleans are **independent**: 2D colouring with no visible bar is
`enabled:true, colorbar:false`; a parked pairing that keeps its config but stops
colouring is `enabled:false`. Both gates are one-line checks in loops that are
already separate (`ensureColorAxis` and `_syncFloats` never shared a pass), so
neither needs a refactor.

`colorbars` already round-trips through `plot.getConfig()` verbatim
(`Plot.js:356`), so both new keys persist with no new serialization code.

## The `axis2d` accessor and object

`plot.axis2d` is a stable Proxy, same pattern as `plot.axes` / `plot.selections`
(`GlBase.js:32-43`): `plot.axis2d[pair]` returns a cached `Axis2d` for the pair,
created on first access. A Proxy `get` trap only ever receives a **string** key —
it cannot receive a tuple — so the ordered `(xAxisQk, yAxisQk)` pair is **encoded
as a string**, `"<qkX>_<qkY>"` (e.g. `plot.axis2d["velocity_ms_density"]`), and
`Axis2d` splits it back into `{xAxis, yAxis}` for find-or-create. x and y roles
matter for the colorscale and the bar, so the key is ordered. The separator is a
single `_`; if a quantity-kind name can itself contain `_`, pick a separator that
cannot collide with a quantity-kind name (decide at implementation). Enumerating
the live pairs walks the layers:

```js
for (const layer of plot.layers)
  for (const [, [sa, sb]] of Object.entries(layer.colorAxes2d))
    pairs.push([layer.colorAxes[sa], layer.colorAxes[sb]])   // [qkX, qkY]
```

`Axis2d` methods, mirroring `Axis`:

| method | mirrors | does |
|---|---|---|
| `axis2d.getConfig()` | `axis.getConfig()` | **defined as** the pair's entry inside `plot.getConfig().colorbars` — the same object that round-trips through `plot.getConfig()` (`Plot.js:356`), not a separately-built view (`{}` if no entry yet). Defining it this way makes the test equivalence below true by construction |
| `axis2d.setConfig(cfg)` | `axis.setConfig()` | **find-or-creates** the `colorbars[]` entry for this pair (matched by `(xAxis, yAxis)`), writes `cfg`, re-applies through the plot's config path. Canonicalises on the pair, so duplicate array entries are not an issue |
| `Axis2d.schema()` *(static)* | `Axis.schema()` *(static)* | the colorbars-item JSON Schema fragment — `Plot.schema(...).properties.colorbars.items` — with the two new keys. Static, no args, same reasoning as `Axis.schema()` |

`getConfig()` on a layer-defined pair that has no entry yet returns `{}` and the
pair colours from its axes' own colorscales — exactly as `axis.getConfig()` on an
axis with no slot override returns `{}` and falls back to the quantity-kind
default.

## Enforcement (both cheap, no shader rebuild)

- **`enabled: false`** → skip this entry in the `ensureColorAxis` loop
  (`Plot.js:415-419`). The member axes keep their own colorscales; `map_color_s_2d`
  stops hitting the 2D branch (`cs_a == cs_b` no longer holds) and the pair falls
  back to per-axis colouring. No rebuild — the 2D path is compiled in whenever the
  layer has the pair and gated at **runtime** on the colorscale indices.
- **`colorbar: false`** → skip the `colorbar2d` tag in `_syncFloats`
  (`Plot.js:798-801`). Float destroyed/not created on the next sync. Widget-only.

## 1D entries

1D colorbars entries (a lone `xAxis` **or** `yAxis`, which make 1D floats,
`Plot.js:802-809`) honour **both** booleans, identically to 2D entries — there is
no special-casing:

- `enabled:false` skips that entry's single-axis `ensureColorAxis` override
  (`Plot.js:415-419`), so the axis reverts to its own colorscale.
- `colorbar:false` skips that entry's 1D float in `_syncFloats`.

The only difference from 2D is that **`axis2d` does not surface 1D entries** — the
accessor is 2D-pairs only. The two keys still apply to 1D entries through plain
config. (Note the minor pre-existing overlap: 1D colorbar floats can also come
from `axes.<qk>.colorbar: "vertical"|"horizontal"`, `_syncFloats:778-785`, hidden
with `"none"`; that path is unchanged and separate from the `colorbar` boolean on
a `colorbars[]` entry.)

## Docs

- `docs/user-api/` (alongside `Axis`): the `plot.axis2d[pair]` accessor and the
  `Axis2d` object — `getConfig()`, `setConfig(cfg)`, static `Axis2d.schema()`.
- `docs/configuration/PlotConfiguration.md`: `enabled` and `colorbar` on a 2D
  `colorbars[]` entry; that `enabled:false` reverts to per-axis colourscales and
  `colorbar:false` hides the float; that both round-trip through `getConfig()`.
- `docs/concepts/` or `docs/configuration/BuiltInLayerTypes.md`: that a 2D pairing
  is layer-defined and surfaced via `axis2d`.

## Tests (web-test-runner, `test/`)

- `plot.axis2d` enumerates exactly the layer-defined 2D pairs; a pair with no
  layer is absent/inert.
- `plot.axis2d["<qkX>_<qkY>"].getConfig()` deep-equals the pair's entry inside
  `plot.getConfig().colorbars` (the governing invariant — `getConfig()` is defined
  as that entry); `setConfig({colorscale})` find-or-creates one entry (no duplicate
  when called twice on the same pair).
- The string key round-trips: `"<qkX>_<qkY>"` splits back to `{xAxis: qkX, yAxis:
  qkY}` and matches the entry it find-or-creates (x/y order preserved).
- `enabled:false` → members keep their own colorscales, pixels are not the 2D map;
  `enabled:true` with a shared 2D colorscale → 2D colouring, no rebuild.
- No entry and `enabled:false` produce identical pixels (both use the individual
  axes).
- A 1D colorbars entry honours `enabled` (skips its single-axis override) and
  `colorbar` (hides its 1D float).
- `colorbar:false` → no colorbar2d float; `colorbar:true` → float present; toggling
  it does not change layer colours.
- `enabled:true, colorbar:false` → 2D colours with no float (the "colour without a
  visible colorbar" case, now explicit).
- `Axis2d.schema()` equals `Plot.schema(...).properties.colorbars.items` and
  includes `enabled`/`colorbar`.
- Config round-trip: setting `enabled`/`colorbar` and calling `getConfig()` returns
  them; `update()` restores them.

## Not in this plan

- Any change to how layers declare `colorAxes2d`.
- Surfacing 1D colorbars entries through `axis2d` (the accessor is 2D-only; the
  two booleans still apply to 1D entries through plain config).
- Lock/reset/visibility on colour axes (that is `axis-visibility-lock-reset.md`).

## Resolved decisions

1. **Disable key** — `enabled`, default `true`.
2. **No entry ≡ `enabled:false`** — a layer-defined pair with no entry colours
   from the individual axes, the same state as an entry with `enabled:false`.
   Nothing is forced implicitly; creating an entry (default `enabled:true`) turns
   the 2D pairing on.
3. **1D entries honour both booleans** identically to 2D entries; only the
   `axis2d` accessor is 2D-only.
4. **The pair key is a string** — a Proxy key cannot be a tuple, so the ordered
   pair is encoded `"<qkX>_<qkY>"` and `Axis2d` splits it back. Separator decided
   at implementation so it cannot collide with a quantity-kind name.
5. **`getConfig()` is defined as `plot.getConfig().colorbars`'s entry** for the
   pair (not a separately-built view), so `plot.axis2d[key].getConfig()` deep-equals
   that entry by construction — mirrors the `Axis` decision in
   `axis-visibility-lock-reset.md`.

## Implementation steps

1. Add `enabled` + `colorbar` to the colorbars-item schema; gate `ensureColorAxis`
   on `enabled`, gate the `colorbar2d` float in `_syncFloats` on `colorbar`; add
   the `plot.axis2d` Proxy, the `Axis2d` object (`getConfig`/`setConfig` over the
   find-or-created colorbars entry), and static `Axis2d.schema()`; tests and docs.
2. A release (maintainer's step).

One PR to `redhog/gladly`. Small — most of it is the `Axis2d` object and the
find-or-create, since the two gates are one-liners.
