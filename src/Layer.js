export class Layer {
  constructor({ type, attributes, uniforms, xAxis = "xaxis_bottom", yAxis = "yaxis_left", xAxisQuantityKind, yAxisQuantityKind, colorAxes = [], filterAxes = [], vertexCount = null }) {
    // Validate that all attributes are typed arrays
    for (const [key, value] of Object.entries(attributes)) {
      if (!(value instanceof Float32Array)) {
        throw new Error(`Attribute '${key}' must be Float32Array`)
      }
    }

    // Validate colorAxes: must be an array of quantity kind strings
    for (const quantityKind of colorAxes) {
      if (typeof quantityKind !== 'string') {
        throw new Error(`Color axis quantity kind must be a string, got ${typeof quantityKind}`)
      }
    }

    // Validate filterAxes: must be an array of quantity kind strings
    for (const quantityKind of filterAxes) {
      if (typeof quantityKind !== 'string') {
        throw new Error(`Filter axis quantity kind must be a string, got ${typeof quantityKind}`)
      }
    }

    this.type = type
    this.attributes = attributes
    this.uniforms = uniforms
    this.xAxis = xAxis
    this.yAxis = yAxis
    this.xAxisQuantityKind = xAxisQuantityKind
    this.yAxisQuantityKind = yAxisQuantityKind
    // colorAxes: string[] — quantity kinds of color axes; attribute named by quantityKind holds the data
    this.colorAxes = colorAxes
    // filterAxes: string[] — quantity kinds of filter axes; attribute named by quantityKind holds the data
    this.filterAxes = filterAxes
    this.vertexCount = vertexCount
  }
}
