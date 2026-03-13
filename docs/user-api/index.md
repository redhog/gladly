# User API

Programmatic APIs for working with plots, axes, data, and computations.

---

## Contents

- [Plot](Plot.md) — main plotting container, update, events, picking
- [Axis](Axis.md) — first-class axis objects, linking axes, custom axis objects
- [PlotGroup](PlotGroup.md) — coordinating multiple plots with atomic updates and auto-linking
- [Data](Data.md) — data normalisation, Data and DataGroup classes
- [ComputePipeline](ComputePipeline.md) — headless GPU compute pipeline for data transforms
- [Widgets](Widgets.md) — manual Colorbar, Colorbar2d, Float, Filterbar creation

## Configuration Reference

The following topics describe configuration options and are used with the APIs above:

- [Configuring Plots](../configuration/PlotConfiguration.md) — layers, axes, transforms, colorbars
- [Built-in Layer Types](../configuration/BuiltInLayerTypes.md) — points, lines, bars, histogram, tile, colorbar, filterbar
- [Computations](../configuration/Computations.md) — transforms and computed attributes

## Reference

- [ColorbarsFilterbars](ColorbarsFilterbars.md) — automatic colorbar and filterbar via config
- [Colorscales](../configuration/Colorscales.md) — colorscale names list
- [Registries](Registries.md) — registerAxisQuantityKind, registerEpsgDef
