export class Layer {
  constructor({ type, attributes, uniforms, xAxis="xaxis_bottom", yAxis="yaxis_left" }) {
    // Validate that all attributes are typed arrays
    for (const [key, value] of Object.entries(attributes)) {
      if (!(value instanceof Float32Array)) {
        throw new Error(`Attribute '${key}' must be Float32Array`)
      }
    }

    this.type = type
    this.attributes = attributes
    this.uniforms = uniforms
    this.xAxis = xAxis
    this.yAxis = yAxis
  }
}
