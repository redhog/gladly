# Selection

API for reading selection results, cross-plot selection linking, and (when needed) programmatic lasso control. The preferred way to enable lasso is via the declarative `interactions.lasso` config key — see [Selection — Configuration](../configuration/Selection.md). For the GPU pipeline internals see [Selection — Architecture](../architecture/Selection.md).

---

## `plot.selections[name]`

Returns a stable `Selection` instance for the given name. The same instance is returned across `plot.update()` calls, so subscriptions survive updates.

```js
const sel = plot.selections['brush1']
```

`Selection` implements the [`ColumnData`](Data.md) interface, so it can be used directly as an attribute value in layer specs or computation inputs:

```js
layers: [{
  points: {
    xData: 'input.x',
    yData: 'input.y',
    vData: plot.selections['brush1'],  // drive color from selection state
  }
}]
```

---

## Selection properties

### `selection.active`

`true` when a lasso has been drawn and at least one point is selected; `false` otherwise (including before any lasso has been drawn).

### `selection.array`

A `Float32Array` of length N with one value per data point: `1` if selected, `0` if not. Returns `null` when `selection.active` is `false`.

```js
plot.selections['brush1'].subscribe(sel => {
  const mask = sel.array   // Float32Array | null
  if (mask) {
    const indices = [...mask.keys()].filter(i => mask[i] > 0.5)
    console.log(`${indices.length} points selected`)
  }
})
```

### `selection.length`

Number of data points tracked by this selection channel, or `null` if no layer has registered it yet.

---

## Selection methods

### `selection.clear()`

Clears the selection and marks it inactive. Triggers a re-render and notifies subscribers.

```js
plot.selections['brush1'].clear()
```

### `selection.applyFrom(otherSelection)`

Copies the selection state from another `Selection` object into this one. Triggers a re-render and notifies subscribers. Used by `linkSelections` internally; also useful for manual cross-plot or cross-component propagation.

```js
plot2.selections['brush1'].applyFrom(plot1.selections['brush1'])
```

### `selection.subscribe(callback)`

Registers a callback fired whenever the selection changes (after any lasso on any linked plot). Returns `{ remove() }` to unregister.

```js
const handle = plot.selections['brush1'].subscribe(sel => {
  console.log('selection changed, active:', sel.active)
})

handle.remove()  // unsubscribe
```

### `selection.unsubscribe(callback)`

Removes a previously registered callback by reference.

---

## LassoInteraction

Low-level class that attaches mouse event handlers to a plot's canvas and calls `plot.selectLasso()` on `mouseup`. Prefer the declarative `interactions.lasso` config key for typical use — instantiate `LassoInteraction` directly only when you need runtime control (e.g. toggling lasso on/off without re-calling `update()`).

```js
import { LassoInteraction } from 'gladly'

const lasso = new LassoInteraction(plot, options)
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `selectionName` | — | Selection channel name (informational only) |
| `trigger` | `'shift'` | Activation modifier: `'shift'`, `'ctrl'`, or `'always'` |
| `mode` | `'lasso'` | Currently only `'lasso'` is implemented |

A SVG polyline overlay is drawn while the user drags. It is removed on `mouseup`.

**Methods:**

- `lasso.destroy()` — removes all event listeners and the SVG overlay

---

## `plot.selectLasso(vertices)`

Runs the GPU selection algorithm for a polygon defined by screen-space vertices.

```js
// vertices: [[x, y], ...] in HTML canvas coordinates (top-left origin)
await plot.selectLasso([[10, 20], [150, 30], [140, 200], [10, 190]])
```

After the GPU pipeline completes, each affected `Selection` object reads back its result to CPU (`selection.array` is updated), then fires its subscribers.

> **Limit:** The lasso polygon may have at most 256 vertices.

---

## `linkSelections(selA, selB)`

Links two `Selection` objects bidirectionally. When a lasso fires on either plot, the result propagates to the other.

```js
import { linkSelections } from 'gladly'

const handle = linkSelections(plot1.selections['brush1'], plot2.selections['brush1'])

// Later, tear down:
handle.unlink()
```

Cross-plot cycles are prevented: the `_propagating` flag on each `Selection` stops a change from bouncing back to its source.

---

## Cross-Plot Linked Selection

```js
const plot1 = new Plot(container1)
const plot2 = new Plot(container2)

const config1 = { layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }], interactions: { lasso: true } }
const config2 = { layers: [{ points: { xData: 'input.x', yData: 'input.z', selection: 'brush1' } }], interactions: { lasso: true } }

await plot1.update({ data: myData, config: config1 })
await plot2.update({ data: myData, config: config2 })

linkSelections(plot1.selections['brush1'], plot2.selections['brush1'])
// Lasso on either plot propagates to the other via the link
```

---

## PlotGroup Auto-Linking

When using [`PlotGroup`](PlotGroup.md) with `autoLink: true`, `_updateAutoLinks()` automatically calls `linkSelections()` for any selection name shared across plots — no manual wiring needed.

```js
const group = new PlotGroup({ plot1, plot2 }, { autoLink: true })

await group.update({
  data: { input: myData },
  plots: {
    plot1: { layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }], interactions: { lasso: true } },
    plot2: { layers: [{ points: { xData: 'input.x', yData: 'input.z', selection: 'brush1' } }], interactions: { lasso: true } },
  }
})
// A lasso on either plot propagates to the other automatically
```

Unlike axis auto-linking (which matches by quantity kind), selection auto-linking matches by **dataset object and selection name together** — both plots must receive the same data object reference and use the same name string for auto-linking to connect them.
