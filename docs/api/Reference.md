# API Reference

Public API entries exposed by `./src/index.js`. For conceptual background see the [main API doc](../API.md). For plot configuration see [Configuring Plots](PlotConfiguration.md). For writing layer types see [Writing Layer Types](LayerTypes.md).

---

## `Plot`

The main plotting container that manages WebGL rendering and SVG axes.

**Constructor:**
```javascript
new Plot(container)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | HTMLElement | Parent `<div>`. Must have explicit CSS dimensions. Canvas and SVG are created inside it automatically. |

**Instance methods:**

### `update({ config, data })`

Updates the plot with new configuration and/or data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | `{ layers, axes }` — see [Configuring Plots](PlotConfiguration.md) |
| `config.layers` | array | Layer specifications: `[{ typeName: params }, ...]` |
| `config.axes` | object | Range overrides for spatial, color, and filter axes |
| `data` | object | Named `Float32Array` values |

**Behaviour:**
- Config-only: stores config, waits for data before rendering
- Data-only: updates data, re-renders with existing config
- Both: updates and renders
- Neither: re-renders (equivalent to `forceUpdate()`)

### `forceUpdate()`

Re-renders with existing config and data.

### `destroy()`

Removes event listeners and destroys the WebGL context.

**Static methods:**

### `Plot.schema()`

Returns JSON Schema (Draft 2020-12) for the plot configuration object, aggregated from all registered layer types.

---

## `registerLayerType(name, layerType)`

Registers a LayerType under a name for use in `config.layers`.

```javascript
registerLayerType("scatter", scatterLayerType)
```

Throws if `name` is already registered.

---

## `getLayerType(name)`

Returns the registered `LayerType` for `name`. Throws with a helpful message if not found.

---

## `getRegisteredLayerTypes()`

Returns an array of all registered layer type name strings.

---

## `scatterLayerType`

A built-in `LayerType` for scatter plots. See [Writing Layer Types — scatterLayerType](LayerTypes.md#scatterlayertype) for full details.

**Parameters:** `xData`, `yData`, `vData` (required), `xAxis`, `yAxis` (optional).
