import { Layer } from "./Layer.js"

export class LayerType {
  constructor({ name, xUnit, yUnit, vert, frag, attributes, schema, createLayer }) {
    this.name = name
    this.xUnit = xUnit
    this.yUnit = yUnit
    this.vert = vert
    this.frag = frag
    this.attributes = attributes

    // Allow schema and createLayer to be provided as constructor parameters
    if (schema) {
      this._schema = schema
    }
    if (createLayer) {
      this._createLayer = createLayer
    }
  }

  createDrawCommand(regl) {
    return regl({
      vert: this.vert,
      frag: this.frag,
      attributes: this.attributes,
      uniforms: {
        xDomain: regl.prop("xDomain"),
        yDomain: regl.prop("yDomain")
      },
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
