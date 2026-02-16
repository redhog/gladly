import { Layer } from "./Layer.js"

export class LayerType {
  constructor({ name, xAxisQuantityUnit, yAxisQuantityUnit, vert, frag, schema, createLayer }) {
    this.name = name
    this.xAxisQuantityUnit = xAxisQuantityUnit
    this.yAxisQuantityUnit = yAxisQuantityUnit
    this.vert = vert
    this.frag = frag

    // Allow schema and createLayer to be provided as constructor parameters
    if (schema) {
      this._schema = schema
    }
    if (createLayer) {
      this._createLayer = createLayer
    }
  }

  createDrawCommand(regl, layer) {
    // Build attributes object dynamically from layer.attributes
    const attributes = {}
    for (const key of Object.keys(layer.attributes)) {
      attributes[key] = { buffer: regl.prop(`attributes.${key}`) }
    }

    // Build uniforms object with standard uniforms plus any layer-specific ones
    const uniforms = {
      xDomain: regl.prop("xDomain"),
      yDomain: regl.prop("yDomain")
    }
    for (const key of Object.keys(layer.uniforms)) {
      uniforms[key] = regl.prop(`uniforms.${key}`)
    }

    return regl({
      vert: this.vert,
      frag: this.frag,
      attributes: attributes,
      uniforms: uniforms,
      viewport: regl.prop("viewport"),
      primitive: "points",
      count: regl.prop("count")
    })
  }

  schema() {
    if (this._schema) {
      return this._schema()
    }
    throw new Error(`LayerType '${this.name}' does not implement schema()`)
  }

  createLayer(parameters, data) {
    if (this._createLayer) {
      return this._createLayer.call(this, parameters, data)
    }
    throw new Error(`LayerType '${this.name}' does not implement createLayer()`)
  }
}
