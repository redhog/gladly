# Selection

Layers opt into selection by adding a `selection` key to their layer specification. This page covers the configuration format and visual behaviour. For the programmatic API (`LassoInteraction`, `plot.selectLasso()`) see [Selection — User API](../user-api/Selection.md). For the GPU pipeline internals see [Selection — Architecture](../architecture/Selection.md).

---

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
        selection: 'brush1'   // opt this layer into a named selection channel
      }
    }
  ]
})

const lasso = new LassoInteraction(plot, { selectionName: 'brush1', trigger: 'shift' })
```

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
