import { LayerType } from '../../core/LayerType.js'
import { registerLayerType } from '../../core/LayerTypeRegistry.js'
import { resolveSource } from './TileLayer.js'
import { ImageTerrainImpl } from './ImageTerrainImpl.js'
import { QmTerrainImpl } from './QmTerrainImpl.js'

// ─── TerrainTileLayerType ─────────────────────────────────────────────────────
// Thin shell registered as 'terrain'. Dispatches to ImageTerrainImpl (RGB-encoded
// DTM tiles) or QmTerrainImpl (quantized-mesh binary tiles) based on dtmSource type.
//
// schema() and resolveAxisConfig() are called by Plot.js on this registered type.
// createLayer() is delegated to the chosen impl; the returned layer has type=impl so
// Plot.js calls impl.createDrawCommand() directly (via layer.type).

class TerrainTileLayerType extends LayerType {
  constructor() {
    super({ name: 'terrain', vert: ' ', frag: ' ', suppressWarnings: true })
    this._imageImpl = new ImageTerrainImpl()
    this._qmImpl    = new QmTerrainImpl()
  }

  _selectImpl(parameters) {
    try {
      const source = resolveSource(parameters?.dtmSource ?? {})
      return source.type === 'quantizedMesh' ? this._qmImpl : this._imageImpl
    } catch {
      return this._imageImpl
    }
  }

  schema(data) {
    // Use the image impl schema; it includes all dtmSource types (image + QM presets)
    // because makeSourceSchema in TileLayer.js now includes quantizedMesh alternatives.
    return this._imageImpl.schema(data)
  }

  resolveAxisConfig(parameters, data) {
    return this._selectImpl(parameters).resolveAxisConfig(parameters, data)
  }

  createLayer(regl, parameters, data, plot) {
    // Delegate to impl; returned layer objects have type=impl so Plot.js calls
    // impl.createDrawCommand() (not this shell's createDrawCommand).
    return this._selectImpl(parameters).createLayer(regl, parameters, data, plot)
  }
}

export const terrainTileLayerType = new TerrainTileLayerType()
registerLayerType('terrain', terrainTileLayerType)
export { TerrainTileLayerType }
