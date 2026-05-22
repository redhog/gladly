# GPU-Driven Lasso Selection

Gladly supports interactive lasso selection that correctly finds **all** data points inside the drawn region, including occluded ones. The algorithm runs entirely on the GPU using a hierarchical pick (binary halving) approach.

## Quick Start

```js
import { Plot, LassoInteraction } from 'gladly'

const plot = new Plot(container)
await plot.update({
  data: myData,
  layers: [
    {
      points: {
        xData: 'input.x',
        yData: 'input.y',
        color: 'input.value',
        selection: 'brush1'   // ← name this layer's selection channel
      }
    }
  ]
})

// Attach mouse interaction — shift+drag draws the lasso
const lasso = new LassoInteraction(plot, { selectionName: 'brush1', trigger: 'shift' })

// Later, clean up
lasso.destroy()
```

## Declarative Configuration

Add a `selection` key to any layer specification to opt that layer into selection:

```js
{
  points: {
    xData: 'input.x',
    yData: 'input.y',
    selection: 'brush1'   // arbitrary string name
  }
}
```

The string name identifies the **selection channel**. Two layers in different plots automatically share a selection if and only if:
1. They declare the **same selection name**, AND
2. Their plots received the **same JavaScript data object** (object identity, not deep equality).

This mirrors how `AxisLink` works — linking is implicit through shared references.

## LassoInteraction

`LassoInteraction` attaches mouse event handlers to a plot's canvas and calls `plot.selectLasso()` on `mouseup`.

```js
const lasso = new LassoInteraction(plot, options)
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `selectionName` | — | Selection channel name (informational; the pipeline uses all layers with a selection column) |
| `trigger` | `'shift'` | Activation key: `'shift'`, `'ctrl'`, or `'always'` |
| `mode` | `'lasso'` | Currently only `'lasso'` is implemented |

A SVG polyline overlay is drawn while the user drags. It is removed on `mouseup`.

**Methods:**

- `lasso.destroy()` — removes all event listeners and the SVG overlay

## Plot API

### `plot.selectLasso(vertices)`

Runs the GPU selection algorithm for a polygon defined by screen-space vertices.

```js
// vertices: [[x, y], ...] in HTML canvas coords (top-left origin)
await plot.selectLasso([[10, 20], [150, 30], [140, 200], [10, 190]])
```

This method:
1. Rasterizes the lasso polygon into a mask FBO
2. Refreshes all data transforms and columns
3. Clears all selection textures for this plot
4. Runs the binary halving loop per layer to find selected data points
5. Propagates the selection to all linked plots (same selection name + same data object)
6. Schedules a re-render on all affected plots

## Visual Appearance

Layers with an active selection render selected and unselected points differently:

- **Selected** (selection value = 1): normal color
- **Not selected** (selection value = 0): faded toward light gray with reduced opacity
- **No active selection** (selection value < -0.5): all points rendered normally (as if no selection exists)

The fading effect is applied per-colorscale via the `map_color_s_sel` GLSL function injected by the shader builder.

## Cross-Plot Linked Selection

Multiple plots sharing the same data object and selection name are automatically linked:

```js
const sharedData = { x: [...], y: [...] }

const plot1 = new Plot(container1)
const plot2 = new Plot(container2)

await plot1.update({ data: sharedData, layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }] })
await plot2.update({ data: sharedData, layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }] })

const lasso = new LassoInteraction(plot1, { trigger: 'shift' })
// Lasso on plot1 automatically updates the selection on plot2 as well
```

The CPU mirror in `SelectionRegistry` bridges the GPU contexts: after the halving loop completes in `plot1`, its selection texture is read back to a CPU `Float32Array` and uploaded to `plot2`'s texture.

> **Note:** Cross-context GPU readback requires the `EXT_color_buffer_float` WebGL extension. This is widely supported in WebGL 2. If not available, the readback silently fails and only the source plot updates.

### PlotGroup auto-linking

When using `PlotGroup` with `autoLink: true`, selection linking between plots with the same selection name is **automatic with no extra configuration**. `PlotGroup.update()` normalises the data argument once and passes the same `DataGroup` instance to every plot. Because `SelectionRegistry` keys entries by `(dataRef, selectionName)`, all layers that declare the same selection name automatically become subscribers to the same registry entry, and any lasso drawn on any plot in the group propagates to all others.

```js
const group = new PlotGroup({ plot1, plot2 }, { autoLink: true })

await group.update({
  data: { input: myData },
  plots: {
    plot1: { layers: [{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }] },
    plot2: { layers: [{ points: { xData: 'input.x', yData: 'input.z', selection: 'brush1' } }] },
  }
})

// Attach a lasso to each plot — either one propagates to the other automatically
const lasso1 = new LassoInteraction(plot1, { trigger: 'shift' })
const lasso2 = new LassoInteraction(plot2, { trigger: 'shift' })
```

Unlike axis auto-linking (which requires the same quantity kind), selection auto-linking requires only that the selection names match — the plotted quantities can differ between views.

## Architecture

The selection pipeline consists of several GPU passes:

| Component | File | Purpose |
|-----------|------|---------|
| `SelectionColumn` | `src/selection/SelectionColumn.js` | Float texture FBO storing 0/1 selection values, 4 per texel |
| `SelectionRegistry` | `src/selection/SelectionRegistry.js` | Global registry keyed by `(dataRef, name)`; manages cross-plot CPU mirror sync |
| `LassoMask` | `src/selection/LassoMask.js` | Rasterizes lasso polygon into an offscreen float FBO |
| `PickCountFbo` | `src/selection/PickCountFbo.js` | Pick FBO (topmost item) + count FBO (additive per-fragment count) |
| `GatherPass` | `src/selection/GatherPass.js` | Point-sprite scatter: for each uniquely-covered screen pixel, writes 1 into the selection texture at the position corresponding to the picked data index |
| `SelectionPipeline` | `src/selection/SelectionPipeline.js` | Orchestrates the binary halving loop |
| `LassoInteraction` | `src/selection/LassoInteraction.js` | Mouse event handler + SVG overlay |

### Binary Halving Algorithm

The algorithm correctly handles overlapping/occluded points:

1. **Mask pass** — rasterize the lasso polygon into a full-canvas mask FBO.
2. **Halving loop** — for each layer, split the data index range `[0, N)` recursively:
   - Render items `[lo, hi)` into the pick FBO (depth test → topmost item) and count FBO (additive → number of items per pixel).
   - **Gather** — for each masked pixel where exactly one item is visible (`count ≤ 1/255`), write 1 into the selection texture at the data index's texel position.
   - If the range has more than one item, recurse on `[lo, mid)` and `[mid, hi)`.
3. After all halvings, every data point visible anywhere in the lasso (even if occluded) is marked as selected.

The GPU commands are submitted synchronously in regl's command queue; no explicit CPU↔GPU synchronisation occurs in the hot loop.

## Limitations

- **Concave lassos** — the mask uses fan triangulation from the centroid, which is exact for convex polygons. Concave lassos may have incorrect fill. Replace with ear-clipping or stencil-based even-odd fill for production use.
- **Halving cost** — the algorithm visits O(N) binary tree nodes. For very large N (millions), consider an occlusion-query optimisation to skip empty subtrees before recursing.
- **Transformed layers** — layers driven by histogram/KDE/FFT transforms have different N from the raw data and cannot be directly selected. They consume a `SelectionColumn` as a computation input instead.
