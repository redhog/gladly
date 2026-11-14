# Selection

Layers opt into selection by adding a `selection` key to their layer specification. This page covers the configuration format and visual behaviour. For the programmatic API (`plot.selectLasso()`, `LassoInteraction`) see [Selection — User API](../user-api/Selection.md). For the GPU pipeline internals see [Selection — Architecture](../architecture/Selection.md).

---

## Quick Start

```js
import { Plot } from 'gladly'

const plot = new Plot(container)
await plot.update({
  data: myData,
  config: {
    layers: [
      {
        points: {
          xData: 'input.x',
          yData: 'input.y',
          color: 'input.value',
          selection: 'brush1'   // opt this layer into a named selection channel
        }
      }
    ],
    interactions: { lasso: true }   // shift-drag to draw a lasso over any selection
  }
})
```

---

## `interactions.lasso`

The `interactions` config key enables interactive behaviours. Setting `lasso: true` attaches a shift-drag lasso to the plot, targeting every selection name declared in the layers:

```js
config: {
  layers: [{ points: { ..., selection: 'brush1' } }],
  interactions: { lasso: true }
}
```

For different triggers per selection channel, pass an explicit array:

```js
interactions: {
  lasso: [
    { selection: 'brush1', trigger: 'shift' },
    { selection: 'brush2', trigger: 'ctrl' }
  ]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `selection` | — | Selection channel name to target |
| `trigger` | `'shift'` | Activation modifier: `'shift'` or `'ctrl'` |
| `mode` | the plot's current mode, `'lasso'` until `plot.setLassoMode()` ([User API](../user-api/Selection.md)) changes it | Selection shape: `'lasso'`, `'rectangle'`, `'triangle'`, `'polygon'`, `'circle'`, `'ellipse'` or `'band'` (see [Selection shapes](#selection-shapes)) |
| `bandWidth` | the plot's current band width, none until `plot.setLassoMode()` sets one | Width of a band click, in the x axis's data units |

With `lasso: true` every interaction takes the plot's current mode and band width. An item's own `mode` or `bandWidth` wins over them.

### Selection shapes

Every shape is drawn with the trigger held, shows its outline while it is being drawn, and selects like the lasso: points inside it, and segments with an end inside or an edge crossing it.

| Mode | Gesture | Selects nothing when |
|------|---------|----------------------|
| `'lasso'` | Drag a free-hand outline | it has fewer than 3 vertices |
| `'rectangle'` | Press at one corner, release at the opposite corner; the sides run along the axes | it is under 5 px wide or tall |
| `'triangle'` | Press at the apex, release at a corner of the base; the other base corner mirrors it across the apex's vertical | it is under 5 px wide or tall |
| `'polygon'` | Click each corner, then right-click or press Enter (no trigger needed) to close; neither adds a corner | it has fewer than 3 corners |
| `'circle'` | Press at the center, release at the radius | its radius is under 5 px |
| `'ellipse'` | Click the center, then the end of the first axis (its direction and length), then a point whose distance from the first axis sets the second axis | either semi-axis is under 5 px |
| `'band'` | Drag to set a strip's two edges — a mostly-horizontal drag makes a full-height vertical strip, a mostly-vertical one a full-width horizontal strip — or click for a vertical strip `bandWidth` wide centered on the click; while the trigger is held, the outline shows the strip a click would select | a drag is under 5 px in both directions and no `bandWidth` is set |

A polygon or an ellipse stays in progress between clicks. Escape, a mousedown without the trigger, a wheel event, a mode change or a plot `update()` abandons it, since its corners are screen positions that a pan or zoom would move off the data. Escape also abandons a drag in progress.

A band's ends run far past the plot's edges, so it also selects points zoomed out of view along its long axis — a vertical band in y, a horizontal band in x. Circles and ellipses are drawn in screen pixels: on unequal or log axes a circle is not round in data units.

---

## The `selection` Layer Key

Add `selection` to any layer spec to opt that layer into a named selection channel:

```js
{ points: { xData: 'input.x', yData: 'input.y', selection: 'brush1' } }
```

The value is an arbitrary string that names the **selection channel**. A selection channel is identified by the combination of **dataset object** and **name** — two layers share a channel only when they reference the same data object *and* the same name string. To synchronise a selection across multiple plots, use [`linkSelections()`](../user-api/Selection.md#linkselections) or [`PlotGroup`](../user-api/PlotGroup.md) with `autoLink: true` — both the dataset and the name must match for auto-linking to connect the layers.

Multiple named selections can coexist:

```js
layers: [
  { points: { xData: 'input.x', yData: 'input.y', selection: 'groupA' } },
  { points: { xData: 'input.x', yData: 'input.z', selection: 'groupB' } },
]
```

---

## Visual Appearance

Layers with an active selection render selected and unselected points differently:

| State | Rendering |
|-------|-----------|
| Selected (value = 1) | Normal colour |
| Not selected (value = 0) | Faded toward light gray with reduced opacity |
| No active selection (value < −0.5) | All points rendered normally |

The fading is applied per-colorscale via the `map_color_s_sel` GLSL function injected by the shader builder.

Transformed layers (histograms, KDE, FFT outputs) cannot be directly selected — they consume a `SelectionColumn` as a computation input instead.
