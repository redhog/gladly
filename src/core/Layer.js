export class Layer {
  constructor({ type, attributes, uniforms, domains = {}, lineWidth = 1, primitive = "points", xAxis = "xaxis_bottom", yAxis = "yaxis_left", xAxisQuantityKind, yAxisQuantityKind, colorAxes = {}, colorAxes2d = {}, filterAxes = {}, vertexCount = null, instanceCount = null, attributeDivisors = {}, blend = null }) {
    // Validate that all attributes are non-null/undefined
    // (Float32Array, regl textures, numbers, and expression objects are all valid)
    for (const [key, value] of Object.entries(attributes)) {
      if (value == null) {
        throw new Error(`Attribute '${key}' must not be null or undefined`)
      }
    }

    // Validate colorAxes: must be a dict mapping GLSL name suffix to quantity kind string
    for (const quantityKind of Object.values(colorAxes)) {
      if (typeof quantityKind !== 'string') {
        throw new Error(`Color axis quantity kind must be a string, got ${typeof quantityKind}`)
      }
    }

    // Validate filterAxes: must be a dict mapping GLSL name suffix to quantity kind string
    for (const quantityKind of Object.values(filterAxes)) {
      if (typeof quantityKind !== 'string') {
        throw new Error(`Filter axis quantity kind must be a string, got ${typeof quantityKind}`)
      }
    }

    this.type = type
    this.attributes = attributes
    this.uniforms = uniforms
    this.domains = domains
    this.lineWidth = lineWidth
    this.primitive = primitive
    this.xAxis = xAxis
    this.yAxis = yAxis
    this.xAxisQuantityKind = xAxisQuantityKind
    this.yAxisQuantityKind = yAxisQuantityKind
    // colorAxes: Record<suffix, qk> — maps GLSL name suffix to quantity kind for each color axis
    // e.g. { '': 'temperature_K' } or { '': 'temp_K', '2': 'pressure_Pa' }
    this.colorAxes = colorAxes
    // colorAxes2d: Record<suffix2d, [suffix1, suffix2]> — maps a 2D function name suffix to a pair
    // of colorAxes suffixes; generates map_color_2d_SUFFIX(vec2) GLSL wrapper
    this.colorAxes2d = colorAxes2d
    // filterAxes: Record<suffix, qk> — maps GLSL name suffix to quantity kind for each filter axis
    this.filterAxes = filterAxes
    this.vertexCount = vertexCount
    this.instanceCount = instanceCount
    this.attributeDivisors = attributeDivisors
    this.blend = blend
  }
}
