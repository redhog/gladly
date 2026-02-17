export class Layer {
  constructor({ type, attributes, uniforms, xAxis="xaxis_bottom", yAxis="yaxis_left", xAxisQuantityUnit, yAxisQuantityUnit, colorAxes = {} }) {
    // Validate that all attributes are typed arrays
    for (const [key, value] of Object.entries(attributes)) {
      if (!(value instanceof Float32Array)) {
        throw new Error(`Attribute '${key}' must be Float32Array`)
      }
    }

    // Validate colorAxes: each entry must be { quantityKind: string, data: Float32Array, colorscale?: string }
    for (const [slot, entry] of Object.entries(colorAxes)) {
      if (!(entry.data instanceof Float32Array)) {
        throw new Error(`Color axis slot '${slot}' data must be Float32Array`)
      }
      if (typeof entry.quantityKind !== 'string') {
        throw new Error(`Color axis slot '${slot}' must have a quantityKind string`)
      }
    }

    this.type = type
    this.attributes = attributes
    this.uniforms = uniforms
    this.xAxis = xAxis
    this.yAxis = yAxis
    this.xAxisQuantityUnit = xAxisQuantityUnit
    this.yAxisQuantityUnit = yAxisQuantityUnit
    // colorAxes: { [slotName]: { quantityKind: string, data: Float32Array } }
    this.colorAxes = colorAxes
  }
}
