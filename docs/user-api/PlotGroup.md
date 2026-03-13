# PlotGroup

`PlotGroup` coordinates a set of named [`Plot`](Plot.md) instances, providing two capabilities:

1. **Atomic updates** — `plotGroup.update()` normalises data once so every plot shares the same `DataGroup` instance, then updates all plots before re-establishing any links. This means an axis QK mismatch caused by one plot being in an intermediate state never reaches `linkAxes()`.

2. **Auto-linking** — when `autoLink: true` is passed to the constructor, any two axes across any two member plots that share the same quantity kind are automatically linked. When a subsequent `update()` changes QKs so that two axes no longer match, the link is silently removed instead of throwing.

When `autoLink` is `false`, you can still link axes manually with [`linkAxes()`](Axis.md#linkaxesaxis1-axis2) using axes from any of the member plots. Those links survive `PlotGroup.update()` calls without firing and without throwing, for two reasons:

- `Axis` instances are stable across `plot.update()` — the same object is returned from `plot.axes[name]` before and after an update, so subscriptions are never disturbed.
- `plot._initialize()` never calls `axis.setDomain()`. Domains are set directly on the underlying D3 scale object (`scale.domain([min, max])`), bypassing the `Axis` pub/sub mechanism entirely. The `ZoomController` only calls `axis.setDomain()` on user interaction, not during construction. So linked axes are never notified during an update.

---

## `new PlotGroup(plots, options)`

```javascript
import { PlotGroup } from 'gladly-plot'

const group = new PlotGroup(
  { left: plotA, right: plotB },
  { autoLink: true }
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `plots` | `{ [name]: Plot }` | Initial set of named plots. May be empty (`{}`). |
| `options.autoLink` | `boolean` | Default `false`. When `true`, axes sharing the same quantity kind across all member plots are automatically linked and kept in sync on every `update()`. |

If `autoLink` is `true`, linking runs immediately at construction time over whatever plots are provided.

---

## Instance methods

### `plotGroup.update({ data, plots })`

Updates any combination of data and per-plot configs, then reconciles auto-links.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | any | Raw data passed to **all** plots. Normalised once via `normalizeData()`, so every plot receives the same `DataGroup` instance. Omit to leave existing data unchanged on all plots. |
| `plots` | `{ [name]: config }` | Per-plot config updates. Each entry is the `config` object accepted by [`plot.update({ config })`](Plot.md#updateconfig-data). Plots not mentioned keep their current config. |

**Ordering guarantee:** All `plot.update()` calls complete before `_updateAutoLinks()` runs. This means `linkAxes()` always sees the final, stable QKs of every plot, never an intermediate state.

```javascript
group.update({
  data: {
    x: new Float32Array([...]),
    y: new Float32Array([...])
  },
  plots: {
    left:  { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] },
    right: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] }
  }
})
```

---

### `plotGroup.add(name, plot)`

Adds a new named plot to the group. If `autoLink` is enabled, auto-links are reconciled immediately.

```javascript
group.add('overview', overviewPlot)
```

---

### `plotGroup.remove(name)`

Removes a named plot from the group, tearing down all auto-managed links that involve it. If the name is not found this is a no-op.

```javascript
group.remove('overview')
```

Manual links created by the user via `linkAxes()` are **not** affected — `PlotGroup` only manages the links it created itself.

---

### `plotGroup.destroy()`

Tears down all auto-managed links. Does not destroy the plots themselves — call `plot.destroy()` on each plot separately if needed.

```javascript
group.destroy()
```

---

## Auto-linking behaviour

When `autoLink: true`, after every `update()`, `add()`, or construction call, `PlotGroup` rebuilds its internal link set as follows:

1. Enumerate every active axis on every member plot — spatial (`xaxis_bottom`, `xaxis_top`, `yaxis_left`, `yaxis_right`), color, and filter axes.
2. Group them by quantity kind.
3. For every pair of axes in the same quantity-kind group that are on **different** plots, ensure a bidirectional link exists via `linkAxes()`.
4. Any existing link whose two axes no longer share a quantity kind is silently removed via `unlink()`.

Links between two axes on the **same** plot are never created — use `linkAxes()` directly for that.

---

## Manual linking with a PlotGroup

When `autoLink` is `false`, axes from member plots can be linked freely:

```javascript
const group = new PlotGroup({ top: plotA, bottom: plotB })

// Link the x-axes manually
const link = linkAxes(plotA.axes.xaxis_bottom, plotB.axes.xaxis_bottom)

// Later updates won't disturb this link:
group.update({ data: newData, plots: { top: newConfig, bottom: newConfig } })

// Clean up when done:
link.unlink()
```

Because `Axis` instances live in the plot's internal axis cache and are never replaced by `plot.update()`, and because `plot._initialize()` sets D3 scale domains directly (bypassing `axis.setDomain()`), linked axes are never notified during updates. The link is completely silent and both plots reach their new state before the link can ever fire.

---

## Examples

### Two plots with a shared x-axis (auto-link)

```javascript
import { Plot, PlotGroup } from 'gladly-plot'

const plotTop    = new Plot(document.getElementById('top'))
const plotBottom = new Plot(document.getElementById('bottom'))

const group = new PlotGroup(
  { top: plotTop, bottom: plotBottom },
  { autoLink: true }
)

group.update({
  data: { x: new Float32Array([...]), y1: new Float32Array([...]), y2: new Float32Array([...]) },
  plots: {
    top:    { layers: [{ points: { xData: 'input.x', yData: 'input.y1' } }] },
    bottom: { layers: [{ points: { xData: 'input.x', yData: 'input.y2' } }] }
  }
})
// Both plots now share the same x-axis range. Panning/zooming one updates the other.
```

### Switching quantity kinds atomically

```javascript
// Change both plots from 'time' x-axis to 'depth' x-axis simultaneously.
// Without PlotGroup, updating plot A first would leave A on 'depth' and B on 'time'
// when the link was re-established, causing a QK mismatch error.
group.update({
  plots: {
    left:  { layers: [{ points: { xData: 'input.depth', yData: 'input.vp'  } }] },
    right: { layers: [{ points: { xData: 'input.depth', yData: 'input.rho' } }] }
  }
})
// Both plots update first; then auto-link re-establishes the shared 'depth' axis cleanly.
```

### Adding and removing plots dynamically

```javascript
const group = new PlotGroup({ main: mainPlot }, { autoLink: true })

// Add a detail view later — auto-link picks up matching quantity kinds immediately:
group.add('detail', detailPlot)
detailPlot.update({
  data: sharedData,
  config: { layers: [{ points: { xData: 'input.x', yData: 'input.y' } }] }
})
group.update({})  // trigger auto-link reconciliation after detail plot initialises

// Remove it when the user closes the panel:
group.remove('detail')
detailPlot.destroy()
```
