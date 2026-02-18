import { Layer } from "./Layer.js"
import { buildColorGlsl } from "./ColorscaleRegistry.js"
import { buildFilterGlsl } from "./FilterAxisRegistry.js"

function buildSpatialGlsl() {
  return `float normalize_axis(float v, vec2 domain, float scaleType) {
  float vt = scaleType > 0.5 ? log(v) : v;
  float d0 = scaleType > 0.5 ? log(domain.x) : domain.x;
  float d1 = scaleType > 0.5 ? log(domain.y) : domain.y;
  return (vt - d0) / (d1 - d0);
}`
}

export class LayerType {
  constructor({
    name,
    // Optional static axis declarations (for schema/introspection — no function call needed)
    xAxis, xAxisQuantityKind,
    yAxis, yAxisQuantityKind,
    colorAxisQuantityKinds,
    filterAxisQuantityKinds,
    // Optional dynamic resolver — overrides statics wherever it returns a non-undefined value
    getAxisConfig,
    // GPU rendering
    primitive, vert, frag, schema, createLayer
  }) {
    this.name = name
    // Static declarations stored as-is (undefined = not declared)
    this.xAxis = xAxis
    this.xAxisQuantityKind = xAxisQuantityKind
    this.yAxis = yAxis
    this.yAxisQuantityKind = yAxisQuantityKind
    this.colorAxisQuantityKinds = colorAxisQuantityKinds ?? []
    this.filterAxisQuantityKinds = filterAxisQuantityKinds ?? []
    this.primitive = primitive ?? "points"
    this.vert = vert
    this.frag = frag

    if (schema) this._schema = schema
    if (createLayer) this._createLayer = createLayer
    if (getAxisConfig) this._getAxisConfig = getAxisConfig
  }

  createDrawCommand(regl, layer) {
    const nm = layer.nameMap
    // Rename an internal name to the shader-visible name via nameMap (identity if absent).
    const shaderName = (internalName) => nm[internalName] ?? internalName
    // Build a single-entry uniform object with renamed key reading from the internal prop name.
    const u = (internalName) => ({ [shaderName(internalName)]: regl.prop(internalName) })

    const attributes = Object.fromEntries(
      Object.entries(layer.attributes).map(([key, buffer]) => [shaderName(key), { buffer }])
    )

    const uniforms = {
      ...u("xDomain"),
      ...u("yDomain"),
      ...u("xScaleType"),
      ...u("yScaleType"),
      ...Object.fromEntries(
        Object.entries(layer.uniforms).map(([key, value]) => [shaderName(key), value])
      )
    }

    // Add per-color-axis uniforms (colorscale index + range + scale type), keyed by quantity kind
    for (const qk of layer.colorAxes) {
      Object.assign(uniforms, u(`colorscale_${qk}`), u(`color_range_${qk}`), u(`color_scale_type_${qk}`))
    }

    // Add per-filter-axis uniforms (vec4: [min, max, hasMin, hasMax] + scale type), keyed by quantity kind
    for (const qk of layer.filterAxes) {
      Object.assign(uniforms, u(`filter_range_${qk}`), u(`filter_scale_type_${qk}`))
    }

    // Inject GLSL helpers before the layer shader body.
    const spatialGlsl = buildSpatialGlsl()
    const colorGlsl = layer.colorAxes.length > 0 ? buildColorGlsl() : ''
    const filterGlsl = layer.filterAxes.length > 0 ? buildFilterGlsl() : ''
    const injectInto = (src, helpers) => {
      const injected = helpers.filter(Boolean).join('\n')
      if (!injected) return src
      const precisionRe = /^\s*precision\s+\S+\s+\S+\s*;\s*$/mg
      const precisions = src.match(precisionRe) ?? []
      const body = src.replace(precisionRe, '')
      return precisions.join('\n') + '\n' + injected + '\n' + body
    }

    return regl({
      vert: injectInto(this.vert, [spatialGlsl, colorGlsl, filterGlsl]),
      frag: injectInto(this.frag, [colorGlsl, filterGlsl]),
      attributes,
      uniforms,
      viewport: regl.prop("viewport"),
      primitive: this.primitive,
      count: regl.prop("count")
    })
  }

  schema(data) {
    if (this._schema) return this._schema(data)
    throw new Error(`LayerType '${this.name}' does not implement schema()`)
  }

  // Resolves axis config by merging static declarations with dynamic getAxisConfig output.
  // Dynamic values (non-undefined) override static values.
  resolveAxisConfig(parameters, data) {
    const resolved = {
      xAxis: this.xAxis,
      xAxisQuantityKind: this.xAxisQuantityKind,
      yAxis: this.yAxis,
      yAxisQuantityKind: this.yAxisQuantityKind,
      colorAxisQuantityKinds: [...this.colorAxisQuantityKinds],
      filterAxisQuantityKinds: [...this.filterAxisQuantityKinds],
    }

    if (this._getAxisConfig) {
      const dynamic = this._getAxisConfig.call(this, parameters, data)
      if (dynamic.xAxis !== undefined)                  resolved.xAxis = dynamic.xAxis
      if (dynamic.xAxisQuantityKind !== undefined)      resolved.xAxisQuantityKind = dynamic.xAxisQuantityKind
      if (dynamic.yAxis !== undefined)                  resolved.yAxis = dynamic.yAxis
      if (dynamic.yAxisQuantityKind !== undefined)      resolved.yAxisQuantityKind = dynamic.yAxisQuantityKind
      if (dynamic.colorAxisQuantityKinds !== undefined) resolved.colorAxisQuantityKinds = dynamic.colorAxisQuantityKinds
      if (dynamic.filterAxisQuantityKinds !== undefined) resolved.filterAxisQuantityKinds = dynamic.filterAxisQuantityKinds
    }

    return resolved
  }

  createLayer(parameters, data) {
    if (!this._createLayer) {
      throw new Error(`LayerType '${this.name}' does not implement createLayer()`)
    }
    const gpuConfig = this._createLayer.call(this, parameters, data)
    const axisConfig = this.resolveAxisConfig(parameters, data)

    return new Layer({
      type: this,
      attributes: gpuConfig.attributes ?? {},
      uniforms: gpuConfig.uniforms ?? {},
      nameMap: gpuConfig.nameMap ?? {},
      vertexCount: gpuConfig.vertexCount ?? null,
      xAxis: axisConfig.xAxis,
      yAxis: axisConfig.yAxis,
      xAxisQuantityKind: axisConfig.xAxisQuantityKind,
      yAxisQuantityKind: axisConfig.yAxisQuantityKind,
      colorAxes: axisConfig.colorAxisQuantityKinds,
      filterAxes: axisConfig.filterAxisQuantityKinds,
    })
  }
}
