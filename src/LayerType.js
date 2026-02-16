import { Layer } from "./Layer.js"

export class LayerType {
  constructor({ name, axisQuantityUnits, vert, frag, schema, createLayer, getAxisQuantityUnits }) {
    this.name = name
    this.axisQuantityUnits = axisQuantityUnits
    this.vert = vert
    this.frag = frag

    // Allow schema, createLayer, and getAxisQuantityUnits to be provided as constructor parameters
    if (schema) {
      this._schema = schema
    }
    if (createLayer) {
      this._createLayer = createLayer
    }
    if (getAxisQuantityUnits) {
      this._getAxisQuantityUnits = getAxisQuantityUnits
    }
  }

  createDrawCommand(regl, layer) {
    // Build attributes object dynamically from layer.attributes
    const attributes = Object.fromEntries(
      Object.entries(layer.attributes).map(([key, buffer]) => [key, { buffer }])
    )

    // Build uniforms object with standard uniforms plus any layer-specific ones
    const uniforms = {
      xDomain: regl.prop("xDomain"),
      yDomain: regl.prop("yDomain"),
      ...Object.fromEntries(
        Object.entries(layer.uniforms).map(([key, value]) => [key, value])
      )
    }

    return regl({
      vert: this.vert,
      frag: this.frag,
      attributes,
      uniforms,
      viewport: regl.prop("viewport"),
      primitive: "points",
      count: regl.prop("count")
    })
  }

  schema(data) {
    if (this._schema) {
      return this._schema(data)
    }
    throw new Error(`LayerType '${this.name}' does not implement schema()`)
  }

  createLayer(parameters, data) {
    if (this._createLayer) {
      const config = this._createLayer.call(this, parameters, data)
      const resolved = this.resolveAxisQuantityUnits(parameters, data)
      return new Layer({
        type: this,
        ...config,
        xAxisQuantityUnit: resolved.x,
        yAxisQuantityUnit: resolved.y
      })
    }
    throw new Error(`LayerType '${this.name}' does not implement createLayer()`)
  }

  getAxisQuantityUnits(parameters, data) {
    if (this._getAxisQuantityUnits) {
      return this._getAxisQuantityUnits.call(this, parameters, data)
    }
    throw new Error(`LayerType '${this.name}' does not implement getAxisQuantityUnits()`)
  }

  resolveAxisQuantityUnits(parameters, data) {
    // Start with static declaration
    let resolved = { ...this.axisQuantityUnits }

    // If any axis is null, resolve it dynamically
    if (resolved.x === null || resolved.y === null) {
      const dynamic = this.getAxisQuantityUnits(parameters, data)
      if (resolved.x === null) {
        if (dynamic.x === null || dynamic.x === undefined) {
          throw new Error(`LayerType '${this.name}' failed to resolve x axis quantity unit`)
        }
        resolved.x = dynamic.x
      }
      if (resolved.y === null) {
        if (dynamic.y === null || dynamic.y === undefined) {
          throw new Error(`LayerType '${this.name}' failed to resolve y axis quantity unit`)
        }
        resolved.y = dynamic.y
      }
    }

    return resolved
  }
}
