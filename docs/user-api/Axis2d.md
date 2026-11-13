# Axis2d

A first-class object representing a **2D colour pairing** on a plot — what [`Axis`](Axis.md) is to a single axis. A 2D pairing fuses two colour axes (an x role and a y role, order matters) so data is coloured from a shared 2D (bivariate) colorscale.

Obtained via `plot.axis2d[key]`, where `key` is the ordered pair of quantity kinds encoded as the string `"<xAxisQk>__<yAxisQk>"`. Because `_` is a legal JavaScript identifier character, dot access works too:

```javascript
const pair = plot.axis2d.reflectance_au__temperature_K
// identical to:
const pair = plot.axis2d["reflectance_au__temperature_K"]
```

`Axis2d` instances are stable — the same object is returned across `plot.update()` calls.

---

## Pairs are defined by layers

The set of pairings that exist is exactly the set of 2D pairs the plot's layers fuse via their colour axes (e.g. a points/lines layer given both `vData` and `vData2`). A pairing is meaningful only when a layer backs it — the same way `plot.axes[name]` is inert until a layer gives that axis a scale.

Enumeration reflects the live, layer-defined pairs:

```javascript
Object.keys(plot.axis2d)              // → ["reflectance_au__temperature_K"]
"reflectance_au__temperature_K" in plot.axis2d   // → true
"voltage_V__distance_m" in plot.axis2d           // → false (no layer fuses this pair)
```

Accessing a key that no layer backs still returns an `Axis2d` handle, but it is inert: its `getConfig()` is `{}` and it does not colour anything until a layer fuses the pair.

---

## Config is the `colorbars` entry

A pairing has no state of its own: its config **is** the matching entry in the plot's [`config.colorbars`](../configuration/PlotConfiguration.md#2d-colorbars) array, found by its `(xAxis, yAxis)` pair. That entry carries the 2D `colorscale` plus two booleans:

| key | default | effect |
|---|---|---|
| `enabled` | `true` | when `false`, the pairing does not override its member axes' colorscales — each axis reverts to its own colorscale, so no forced 2D colouring. **No entry ≡ `enabled: false`**: both mean "colour from the individual axes". |
| `colorbar` | `true` | when `false`, the floating 2D colorbar widget is not drawn. |

The two booleans are independent — `enabled: true, colorbar: false` gives 2D colouring with no visible bar.

---

## Interface

### `axis2d.xAxis` / `axis2d.yAxis`

`string` — the x-role and y-role quantity kinds of the pair (split from the string key).

### `axis2d.getConfig()`

Returns the pair's entry inside `plot.getConfig().colorbars` — the same object that round-trips through `plot.getConfig()`. Returns `{}` when no entry exists yet (which, like `enabled: false`, means "colour from each axis's own colorscale").

### `axis2d.setConfig(cfg)`

`async`. Find-or-creates the `colorbars` entry for this pair (matched on the ordered `(xAxis, yAxis)` pair), merges `cfg` into it, and re-applies through `plot.update()`. Canonicalises on the pair, so calling it twice does not create duplicate entries.

```javascript
await plot.axis2d.reflectance_au__temperature_K.setConfig({
  colorscale: "bilinear4corner",   // turn the 2D pairing on
  colorbar: false,                 // …without a visible colorbar
})

// Park the pairing (revert to per-axis colourscales) without losing the entry:
await plot.axis2d.reflectance_au__temperature_K.setConfig({ enabled: false })
```

### `Axis2d.schema(data, config)` *(static)*

Returns the `colorbars`-item JSON Schema fragment (including the `enabled` and `colorbar` keys) — i.e. `Plot.schema(data, config).properties.colorbars.items`. Static, no instance required.

---

## Key encoding

A Proxy key can only ever be a string, so the ordered pair is encoded as `"<xAxisQk>__<yAxisQk>"`. The `__` (double-underscore) separator is chosen for two reasons: it is reserved — [`registerAxisQuantityKind`](Registries.md) throws if a quantity-kind name contains `__` — so it cannot collide with a name, and the x role is recovered from the first `__`; and it is made of legal JavaScript identifier characters, so the key also works with dot access (`plot.axis2d.reflectance_au__temperature_K`). Build or split keys explicitly with the static helpers:

```javascript
Axis2d.makeKey("reflectance_au", "temperature_K")   // → "reflectance_au__temperature_K"
Axis2d.splitKey("reflectance_au__temperature_K")     // → ["reflectance_au", "temperature_K"]
```
