# Axis

A first-class object representing a single axis on a plot. Obtained via `plot.axes[axisName]`.

Axis instances are stable — the same object is returned across `plot.update()` calls, so links survive reconfiguration.

---

## Interface

(also accepted by `linkAxes()` for duck typing):

### `axis.quantityKind`

`string | null` — the quantity kind for this axis. `null` before the plot has been initialized with `update()`.

### `axis.getDomain()`

Returns `[min, max]` or `null` if the axis has no domain yet.

For filter axes, either bound may be `null` (open bound).

### `axis.setDomain(domain)`

Sets the axis domain, schedules a render on the owning plot, and notifies all subscribers (e.g. axes linked via `linkAxes`).

A re-entrancy guard prevents infinite loops when axes are linked bidirectionally.

**`axis.setDomain(null)`** (or an absent `domain`) **resets the axis to its data range** — the data extent of the axis's quantity kind. The marker is resolved to concrete numbers at the entry point, so subscribers and linked axes receive this axis's resolved `[min, max]` (never the marker, which a linked plot would otherwise re-resolve against its own data). It keeps a reversed axis reversed and a log axis above zero, exactly as auto-fit does. If there is no stored data extent, the call is a no-op. `plot.resetAxes()` is the whole-plot convenience over this (see [Plot.md](Plot.md#resetaxes)).

### `axis.subscribe(callback)`

Adds a subscriber. `callback([min, max])` is called after every `setDomain()` on this axis.

### `axis.unsubscribe(callback)`

Removes a previously added subscriber.

---

## Per-axis config / schema

These are the per-axis counterparts of `plot.getConfig()`, `plot.update({ config })` and the static `Plot.schema()`, scoped to this one axis's `axes.<slot>` slice. They store no state of their own — the single source of truth remains `axes.<slot>` in the plot config.

### `axis.getConfig()`

Returns the **merged** per-slot config for this axis — identical to `plot.getConfig().axes[slot]`, not the raw `currentConfig.axes[slot]` override slice. The governing round-trip invariant holds by construction:

```javascript
plot.getConfig().axes[slot]   // deep-equals
plot.axes[slot].getConfig()
```

The merge layers the quantity kind's defaults, the stored override overlay, the live domain (`min`/`max`), and the bound `quantity_kind`, so every key — including `visible`, `tickLabelsVisible`, `titleVisible`, `locked` — round-trips for free.

### `axis.setConfig(cfg)`

Writes `cfg` as this axis's `axes.<slot>` object and re-applies it through the plot's normal config path (`plot.update({ config })`), so every key (`min`/`max`/`scale`/`quantity_kind`/`visible`/`tickLabelsVisible`/`titleVisible`/`locked`) takes effect. Returns a promise. Heavier than `plot.setAxisLocked()`, which is the render-only fast path for the single `locked` key.

```javascript
await plot.axes.xaxis_bottom.setConfig({ min: 0, max: 10, titleVisible: false })
```

### `Axis.schema()` *(static)*

Returns the JSON Schema fragment that governs one axis config — exactly `Plot.schema().properties.axes.additionalProperties`. Because the plot schema describes every slot with a single `additionalProperties` schema, this fragment is the same for every axis; it is what a menu/editor validates a slot config against. It is **static and takes no arguments** (mirroring the static `Plot.schema()`): the fragment depends on neither data nor config — its only dynamic piece, the `colorscale` enum, comes from the global colorscale registries.

```javascript
import { Axis } from 'gladly'
const axisSchema = Axis.schema()
```

---

## `linkAxes(axis1, axis2)`

Links two axes bidirectionally. When either axis's domain changes via `setDomain()`, the other is updated to match.

```javascript
linkAxes(plot1.axes.xaxis_bottom, plot2.axes.xaxis_top)
```

Quantity kinds are validated at call time if both axes have known quantity kinds (i.e. after `update()` has been called on both plots). Incompatible kinds throw an error.

Returns `{ unlink() }` to tear down the link.

Any object implementing the [`Axis` interface](#axis) may be passed — see [Custom axis objects](#custom-axis-objects) below.

### Unlinking

Store the return value and call `unlink()` when the connection should be removed:

```javascript
const link = linkAxes(plot1.axes.xaxis_bottom, plot2.axes.xaxis_top)

// Later — e.g. when the user switches views, or one plot is destroyed:
link.unlink()
```

After `unlink()` the two axes are fully independent again. If a `Plot` is destroyed with `plot.destroy()`, its axis listeners are cleared automatically, but the complementary side of any link still holds a dead callback. Explicitly calling `unlink()` before destroying a plot is the clean way to avoid that.

**Links are silent during `plot.update()`.**  `plot._initialize()` sets D3 scale domains directly (bypassing `axis.setDomain()`), so linked axes are never notified when a plot is reconfigured. Links only fire on user interaction (zoom/pan) or explicit `axis.setDomain()` calls. This means it is safe to have a link between two plots and call `plot.update()` on both — even if the update changes quantity kinds — without the link firing in an intermediate state or throwing.

---

## Custom axis objects

Any object that satisfies the `Axis` interface can be passed to `linkAxes()`. This lets you synchronise a Gladly axis with external state — a UI control, another charting library, server state, a URL parameter, etc.

### The interface contract

| Member | Type | Requirement |
|--------|------|-------------|
| `quantityKind` | `string \| null` | Identifies the physical quantity. Used for compatibility validation in `linkAxes`. May be `null` if unknown. |
| `getDomain()` | `() => [min, max] \| null` | Returns the current domain, or `null` if not yet set. |
| `setDomain(domain)` | `([min, max]) => void` | Sets the domain **and** notifies all subscribers. Must implement a re-entrancy guard (see below). |
| `subscribe(callback)` | `(([min, max]) => void) => void` | Registers a callback to be called by `setDomain`. |
| `unsubscribe(callback)` | `(([min, max]) => void) => void` | Removes a previously registered callback. |

### The re-entrancy guard

`linkAxes` wires each axis so that when axis A calls `setDomain`, axis B's `setDomain` is called, and vice-versa. Without a guard this causes an infinite loop. The built-in `Axis` class breaks the cycle with a boolean flag:

- Before calling subscribers, set `_propagating = true`.
- At the top of `setDomain`, return immediately if `_propagating` is already `true`.
- Reset `_propagating = false` in a `finally` block.

Any custom implementation must do the same.

### Minimal example

```javascript
class ExternalAxis {
  constructor(quantityKind) {
    this.quantityKind = quantityKind
    this._domain = null
    this._listeners = new Set()
    this._propagating = false
  }

  getDomain() {
    return this._domain
  }

  setDomain(domain) {
    if (this._propagating) return   // re-entrancy guard
    this._propagating = true
    try {
      this._domain = domain
      this._onDomainChanged(domain) // update your own state / UI here
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }

  _onDomainChanged(domain) {
    // Override or extend to react to changes, e.g. update a UI widget.
  }
}
```

Usage:

```javascript
const externalAxis = new ExternalAxis("velocity_ms")
const link = linkAxes(plot.axes["velocity_ms"], externalAxis)

// Pan/zoom on the plot → externalAxis._domain is updated automatically.
// Call externalAxis.setDomain([0, 10]) → plot re-renders with the new range.
// link.unlink() when you no longer want the two to be connected.
```

### Example: syncing with a range slider

```javascript
class SliderAxis {
  constructor(quantityKind, minInput, maxInput) {
    this.quantityKind = quantityKind
    this._minInput = minInput
    this._maxInput = maxInput
    this._domain = null
    this._listeners = new Set()
    this._propagating = false

    const notify = () => {
      const domain = [parseFloat(minInput.value), parseFloat(maxInput.value)]
      this.setDomain(domain)
    }
    minInput.addEventListener('input', notify)
    maxInput.addEventListener('input', notify)
  }

  getDomain() { return this._domain }

  setDomain(domain) {
    if (this._propagating) return
    this._propagating = true
    try {
      this._domain = domain
      // Keep sliders in sync when the plot's zoom changes the domain.
      this._minInput.value = domain[0]
      this._maxInput.value = domain[1]
      for (const cb of this._listeners) cb(domain)
    } finally {
      this._propagating = false
    }
  }

  subscribe(callback)   { this._listeners.add(callback) }
  unsubscribe(callback) { this._listeners.delete(callback) }
}

const slider = new SliderAxis("velocity_ms",
  document.getElementById("min-slider"),
  document.getElementById("max-slider")
)
const link = linkAxes(plot.axes["velocity_ms"], slider)
```
