export { LayerType } from "./LayerType.js"
export { Layer } from "./Layer.js"
export { AxisRegistry, AXES } from "./AxisRegistry.js"
export { ColorAxisRegistry } from "./ColorAxisRegistry.js"
export { Plot } from "./Plot.js"
export { scatterLayerType } from "./ScatterLayer.js"
export { registerLayerType, getLayerType, getRegisteredLayerTypes } from "./LayerTypeRegistry.js"
export { registerAxisQuantityUnit, getAxisQuantityUnit, getRegisteredAxisQuantityUnits } from "./AxisQuantityUnitRegistry.js"
export { registerColorscale, getRegisteredColorscales, getColorscaleIndex, buildColorGlsl } from "./ColorscaleRegistry.js"
export { linkAxes, AxisLink } from "./AxisLink.js"

// Register all matplotlib colorscales (side-effect import)
import "./MatplotlibColorscales.js"
