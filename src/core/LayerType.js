import { Layer } from "./Layer.js"
import { buildColorGlsl } from "../colorscales/ColorscaleRegistry.js"
import { buildFilterGlsl } from "../axes/FilterAxisRegistry.js"
import { resolveAttributeExpr } from "../compute/ComputationRegistry.js"

function buildSpatialGlsl() {
  return `float normalize_axis(float v, vec2 domain, float scaleType) {
  float vt = scaleType > 0.5 ? log(v) : v;
  float d0 = scaleType > 0.5 ? log(domain.x) : domain.x;
  float d1 = scaleType > 0.5 ? log(domain.y) : domain.y;
  return (vt - d0) / (d1 - d0);
}`
}

function buildApplyColorGlsl() {
  return `uniform float u_pickingMode;
uniform float u_pickLayerIndex;
varying float v_pickId;
vec4 gladly_apply_color(vec4 color) {
  if (u_pickingMode > 0.5) {
    float layerIdx = u_pickLayerIndex + 1.0;
    float dataIdx = floor(v_pickId + 0.5);
    return vec4(
      layerIdx / 255.0,
      floor(dataIdx / 65536.0) / 255.0,
      floor(mod(dataIdx, 65536.0) / 256.0) / 255.0,
      mod(dataIdx, 256.0) / 255.0
    );
  }
  return color;
}`
}

// Removes `attribute [precision] type varName;` from GLSL source.
function removeAttributeDecl(src, varName) {
  return src.replace(
    new RegExp(`[ \\t]*attribute\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+${varName}\\s*;[ \\t]*\\n?`, 'g'),
    ''
  )
}

// Injects code immediately after `void main() {`.
function injectIntoMainStart(src, code) {
  return src.replace(
    /void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/,
    match => `${match}\n  ${code}`
  )
}

function injectPickIdAssignment(src) {
  const lastBrace = src.lastIndexOf('}')
  if (lastBrace === -1) return src
  return src.slice(0, lastBrace) + '  v_pickId = a_pickId;\n}'
}

function injectInto(src, helpers) {
  const injected = helpers.filter(Boolean).join('\n')
  if (!injected) return src
  const versionRe = /^[ \t]*#version[^\n]*\n?/
  const versionMatch = src.match(versionRe)
  const version = versionMatch ? versionMatch[0] : ''
  const rest = version ? src.slice(version.length) : src
  const precisionRe = /^\s*precision\s+\S+\s+\S+\s*;\s*$/mg
  const precisions = rest.match(precisionRe) ?? []
  const body = rest.replace(precisionRe, '')
  return version + precisions.join('\n') + '\n' + injected + '\n' + body
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
    vert, frag, schema, createLayer, createDrawCommand
  }) {
    this.name = name
    // Static declarations stored as-is (undefined = not declared)
    this.xAxis = xAxis
    this.xAxisQuantityKind = xAxisQuantityKind
    this.yAxis = yAxis
    this.yAxisQuantityKind = yAxisQuantityKind
    this.colorAxisQuantityKinds = colorAxisQuantityKinds ?? {}
    this.filterAxisQuantityKinds = filterAxisQuantityKinds ?? {}
    this.vert = vert
    this.frag = frag

    if (schema) this._schema = schema
    if (createLayer) this._createLayer = createLayer
    if (getAxisConfig) this._getAxisConfig = getAxisConfig
    if (createDrawCommand) this.createDrawCommand = createDrawCommand
  }

  createDrawCommand(regl, layer, plot) {
    // --- Resolve computed attributes ---
    let vertSrc = this.vert
    const originalBufferAttrs = {}   // name → Float32Array
    const computedBufferAttrs = {}   // name → Float32Array  (from context.bufferAttrs)
    const allTextureUniforms = {}
    const allScalarUniforms = {}
    const allGlobalDecls = []
    const mainInjections = []
    const allAxisUpdaters = []

    for (const [key, expr] of Object.entries(layer.attributes)) {
      const result = resolveAttributeExpr(regl, expr, key, plot)
      if (result.kind === 'buffer') {
        originalBufferAttrs[key] = result.value
      } else {
        vertSrc = removeAttributeDecl(vertSrc, key)
        Object.assign(computedBufferAttrs, result.context.bufferAttrs)
        Object.assign(allTextureUniforms, result.context.textureUniforms)
        Object.assign(allScalarUniforms, result.context.scalarUniforms)
        allGlobalDecls.push(...result.context.globalDecls)
        mainInjections.push(`float ${key} = ${result.glslExpr};`)
        allAxisUpdaters.push(...result.context.axisUpdaters)
      }
    }

    layer._axisUpdaters = allAxisUpdaters

    if (mainInjections.length > 0) {
      vertSrc = injectIntoMainStart(vertSrc, mainInjections.join('\n  '))
    }

    // Merged buffer attrs — used for vertex count fallback.
    const allShaderBuffers = { ...originalBufferAttrs, ...computedBufferAttrs }

    const isInstanced = layer.instanceCount !== null
    const pickCount = isInstanced ? layer.instanceCount :
      (layer.vertexCount ?? allShaderBuffers['x']?.length
        ?? Object.values(layer.attributes).find(v => v instanceof Float32Array)?.length ?? 0)
    const pickIds = new Float32Array(pickCount)
    for (let i = 0; i < pickCount; i++) pickIds[i] = i

    // --- Build regl attributes ---
    const attributes = {
      // Original buffer attrs with possible divisors
      ...Object.fromEntries(
        Object.entries(originalBufferAttrs).map(([key, buffer]) => {
          const divisor = layer.attributeDivisors[key]
          const attrObj = divisor !== undefined ? { buffer, divisor } : { buffer }
          return [key, attrObj]
        })
      ),
      // Computed buffer attrs (no divisors)
      ...Object.fromEntries(
        Object.entries(computedBufferAttrs).map(([key, buffer]) => [key, { buffer }])
      ),
      a_pickId: isInstanced ? { buffer: regl.buffer(pickIds), divisor: 1 } : regl.buffer(pickIds)
    }

    // --- Build uniforms ---
    const uniforms = {
      xDomain: regl.prop("xDomain"),
      yDomain: regl.prop("yDomain"),
      xScaleType: regl.prop("xScaleType"),
      yScaleType: regl.prop("yScaleType"),
      u_pickingMode: regl.prop('u_pickingMode'),
      u_pickLayerIndex: regl.prop('u_pickLayerIndex'),
      ...layer.uniforms,
      ...allTextureUniforms,
      ...allScalarUniforms
    }

    // Add per-color-axis uniforms keyed by GLSL name suffix → quantity kind.
    // For suffix '' and qk 'temp_K': colorscale, color_range, color_scale_type read from prop colorscale_temp_K etc.
    for (const [suffix, qk] of Object.entries(layer.colorAxes)) {
      uniforms[`colorscale${suffix}`]       = regl.prop(`colorscale_${qk}`)
      uniforms[`color_range${suffix}`]      = regl.prop(`color_range_${qk}`)
      uniforms[`color_scale_type${suffix}`] = regl.prop(`color_scale_type_${qk}`)
    }

    // Add per-filter-axis uniforms (vec4: [min, max, hasMin, hasMax] + scale type).
    for (const [suffix, qk] of Object.entries(layer.filterAxes)) {
      uniforms[`filter_range${suffix}`]      = regl.prop(`filter_range_${qk}`)
      uniforms[`filter_scale_type${suffix}`] = regl.prop(`filter_scale_type_${qk}`)
    }

    // Inject GLSL helpers before the layer shader body.
    const spatialGlsl = buildSpatialGlsl()
    const colorGlsl = Object.keys(layer.colorAxes).length > 0 ? buildColorGlsl() : ''
    const filterGlsl = Object.keys(layer.filterAxes).length > 0 ? buildFilterGlsl() : ''
    const pickVertDecls = `attribute float a_pickId;\nvarying float v_pickId;`

    const drawConfig = {
      vert: injectPickIdAssignment(injectInto(vertSrc, [spatialGlsl, filterGlsl, pickVertDecls, ...allGlobalDecls])),
      frag: injectInto(this.frag, [buildApplyColorGlsl(), colorGlsl, filterGlsl]),
      attributes,
      uniforms,
      viewport: regl.prop("viewport"),
      primitive: layer.primitive,
      lineWidth: layer.lineWidth,
      count: regl.prop("count"),
      ...(layer.blend ? { blend: layer.blend } : {})
    }

    if (layer.instanceCount !== null) {
      drawConfig.instances = regl.prop("instances")
    }

    return regl(drawConfig)
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
      colorAxisQuantityKinds: { ...this.colorAxisQuantityKinds },
      filterAxisQuantityKinds: { ...this.filterAxisQuantityKinds },
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
    const gpuConfigs = this._createLayer.call(this, parameters, data)
    const axisConfig = this.resolveAxisConfig(parameters, data)

    return gpuConfigs.map(gpuConfig => new Layer({
      type: this,
      attributes: gpuConfig.attributes ?? {},
      uniforms: gpuConfig.uniforms ?? {},
      domains: gpuConfig.domains ?? {},
      lineWidth: gpuConfig.lineWidth ?? 1,
      primitive: gpuConfig.primitive ?? "points",
      vertexCount: gpuConfig.vertexCount ?? null,
      instanceCount: gpuConfig.instanceCount ?? null,
      attributeDivisors: gpuConfig.attributeDivisors ?? {},
      blend: gpuConfig.blend ?? null,
      xAxis: axisConfig.xAxis,
      yAxis: axisConfig.yAxis,
      xAxisQuantityKind: axisConfig.xAxisQuantityKind,
      yAxisQuantityKind: axisConfig.yAxisQuantityKind,
      colorAxes: axisConfig.colorAxisQuantityKinds,
      filterAxes: axisConfig.filterAxisQuantityKinds,
    }))
  }
}
