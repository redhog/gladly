export class LayerType {
  constructor({ name, xUnit, yUnit, vert, frag, attributes }) {
    this.name = name
    this.xUnit = xUnit
    this.yUnit = yUnit
    this.vert = vert
    this.frag = frag
    this.attributes = attributes
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
}
