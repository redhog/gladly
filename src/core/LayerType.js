import { Layer } from "./Layer.js"
import { buildColorGlsl } from "../colorscales/ColorscaleRegistry.js"
import { buildFilterGlsl } from "../axes/FilterAxisRegistry.js"
import { resolveAttributeExpr } from "../compute/ComputationRegistry.js"
import { SAMPLE_COLUMN_GLSL } from "../data/ColumnData.js"

function buildSpatialGlsl() {
  return `uniform vec2 xDomain;
uniform vec2 yDomain;
uniform float xScaleType;
uniform float yScaleType;
float normalize_axis(float v, vec2 domain, float scaleType) {
  float vt = scaleType > 0.5 ? log(v) : v;
  float d0 = scaleType > 0.5 ? log(domain.x) : domain.x;
  float d1 = scaleType > 0.5 ? log(domain.y) : domain.y;
  return (vt - d0) / (d1 - d0);
}
vec4 plot_pos(vec2 pos) {
  float nx = normalize_axis(pos.x, xDomain, xScaleType);
  float ny = normalize_axis(pos.y, yDomain, yScaleType);
  return vec4(nx*2.0-1.0, ny*2.0-1.0, 0.0, 1.0);
}`
}

function buildApplyColorGlsl() {
  return `out vec4 fragColor;
uniform float u_pickingMode;
uniform float u_pickLayerIndex;
in float v_pickId;
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

function removeAttributeDecl(src, varName) {
  return src.replace(
    new RegExp(`[ \\t]*in\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+${varName}\\s*;[ \\t]*\\n?`, 'g'),
    ''
  )
}

function removeUniformDecl(src, varName) {
  return src.replace(
    new RegExp(`[ \\t]*uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+${varName}\\s*;[ \\t]*\\n?`, 'g'),
    ''
  )
}

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
    xAxis, xAxisQuantityKind,
    yAxis, yAxisQuantityKind,
    colorAxisQuantityKinds,
    colorAxis2dQuantityKinds,
    filterAxisQuantityKinds,
    getAxisConfig,
    vert, frag, schema, createLayer, createDrawCommand
  }) {
    this.name = name
    this.xAxis = xAxis
    this.xAxisQuantityKind = xAxisQuantityKind
    this.yAxis = yAxis
    this.yAxisQuantityKind = yAxisQuantityKind
    this.colorAxisQuantityKinds = colorAxisQuantityKinds ?? {}
    this.colorAxis2dQuantityKinds = colorAxis2dQuantityKinds ?? {}
    this.filterAxisQuantityKinds = filterAxisQuantityKinds ?? {}
    this.vert = vert
    this.frag = frag

    if (schema) this._schema = schema
    if (createLayer) this._createLayer = createLayer
    if (getAxisConfig) this._getAxisConfig = getAxisConfig
    if (createDrawCommand) this.createDrawCommand = createDrawCommand
  }

  createDrawCommand(regl, layer, plot) {
    // --- Resolve attributes ---
    let vertSrc = this.vert
    const bufferAttrs = {}         // name → Float32Array (fixed geometry)
    const allTextures = {}         // uniformName → () => texture
    const allDataColumns = []      // ColumnData instances for refresh()
    const mainInjections = []      // float name = expr; injected inside main()

    for (const [key, expr] of Object.entries(layer.attributes)) {
      const result = resolveAttributeExpr(regl, expr, key, plot)
      if (result.kind === 'buffer') {
        bufferAttrs[key] = result.value
      } else {
        vertSrc = removeAttributeDecl(vertSrc, key)
        Object.assign(allTextures, result.textures)
        mainInjections.push(`float ${key} = ${result.glslExpr};`)
        allDataColumns.push(result.col)
      }
    }

    layer._dataColumns = allDataColumns

    if (mainInjections.length > 0) {
      vertSrc = injectIntoMainStart(vertSrc, mainInjections.join('\n  '))
    }

    // Validate buffer attributes
    for (const [key, buf] of Object.entries(bufferAttrs)) {
      if (buf instanceof Float32Array && buf.length === 0) {
        console.warn(`[gladly] Layer '${this.name}': buffer attribute '${key}' is an empty Float32Array — this layer may draw nothing`)
      }
    }

    // Pick IDs
    const isInstanced = layer.instanceCount !== null
    const pickCount = isInstanced ? layer.instanceCount :
      (layer.vertexCount ??
        Object.values(bufferAttrs).find(v => v instanceof Float32Array)?.length ?? 0)
    if (pickCount === 0) {
      console.warn(
        `[gladly] Layer '${this.name}': ` +
        `${isInstanced ? 'instanceCount' : 'vertex count'} resolved to 0 — ` +
        `this layer will draw nothing. Check that data columns are non-empty.`
      )
    }
    const pickIds = new Float32Array(pickCount)
    for (let i = 0; i < pickCount; i++) pickIds[i] = i

    // Sampler declarations for column textures
    const samplerDecls = Object.keys(allTextures)
      .map(n => `uniform sampler2D ${n};`)
      .join('\n')

    // Build regl attributes
    const attributes = {
      ...Object.fromEntries(
        Object.entries(bufferAttrs).map(([key, buffer]) => {
          const divisor = layer.attributeDivisors[key]
          return [key, divisor !== undefined ? { buffer, divisor } : { buffer }]
        })
      ),
      a_pickId: isInstanced ? { buffer: pickIds, divisor: 1 } : { buffer: pickIds }
    }

    // Build uniforms
    const uniforms = {
      xDomain: regl.prop("xDomain"),
      yDomain: regl.prop("yDomain"),
      xScaleType: regl.prop("xScaleType"),
      yScaleType: regl.prop("yScaleType"),
      u_pickingMode: regl.prop('u_pickingMode'),
      u_pickLayerIndex: regl.prop('u_pickLayerIndex'),
      ...layer.uniforms,
      ...Object.fromEntries(Object.entries(allTextures).map(([k, fn]) => [k, fn]))
    }

    for (const [suffix, qk] of Object.entries(layer.colorAxes)) {
      uniforms[`colorscale${suffix}`]       = regl.prop(`colorscale_${qk}`)
      uniforms[`color_range${suffix}`]      = regl.prop(`color_range_${qk}`)
      uniforms[`color_scale_type${suffix}`] = regl.prop(`color_scale_type_${qk}`)
      uniforms[`alpha_blend${suffix}`]      = regl.prop(`alpha_blend_${qk}`)
    }

    for (const [suffix, qk] of Object.entries(layer.filterAxes)) {
      uniforms[`filter_range${suffix}`]      = regl.prop(`filter_range_${qk}`)
      uniforms[`filter_scale_type${suffix}`] = regl.prop(`filter_scale_type_${qk}`)
    }

    // Strip spatial uniforms from vert (re-declared in buildSpatialGlsl)
    vertSrc = removeUniformDecl(vertSrc, 'xDomain')
    vertSrc = removeUniformDecl(vertSrc, 'yDomain')
    vertSrc = removeUniformDecl(vertSrc, 'xScaleType')
    vertSrc = removeUniformDecl(vertSrc, 'yScaleType')

    const spatialGlsl = buildSpatialGlsl()
    const colorGlsl = (Object.keys(layer.colorAxes).length > 0 || Object.keys(layer.colorAxes2d).length > 0) ? buildColorGlsl() : ''
    const filterGlsl = Object.keys(layer.filterAxes).length > 0 ? buildFilterGlsl() : ''
    const pickVertDecls = `in float a_pickId;\nout float v_pickId;`

    // Column helpers: precision + samplers + sampleColumn function
    const columnHelpers = allDataColumns.length > 0
      ? `precision highp sampler2D;\n${samplerDecls}\n${SAMPLE_COLUMN_GLSL}`
      : ''

    const fnSuffix = (s) => s.replace(/^_+/, '')

    const colorHelperLines = []
    let fragSrc = this.frag
    for (const [suffix] of Object.entries(layer.colorAxes)) {
      colorHelperLines.push(
        `uniform int colorscale${suffix};`,
        `uniform vec2 color_range${suffix};`,
        `uniform float color_scale_type${suffix};`,
        `uniform float alpha_blend${suffix};`,
        `vec4 map_color_${fnSuffix(suffix)}(float value) {`,
        `  return map_color_s(colorscale${suffix}, color_range${suffix}, value, color_scale_type${suffix}, alpha_blend${suffix});`,
        `}`,
        `vec4 map_color_2d_x_${fnSuffix(suffix)}(float value) {`,
        `  return map_color_s_2d(colorscale${suffix}, color_range${suffix}, value, color_scale_type${suffix}, alpha_blend${suffix},`,
        `                        colorscale${suffix}, color_range${suffix}, 0.0/0.0, color_scale_type${suffix}, 0.0);`,
        `}`,
        `vec4 map_color_2d_y_${fnSuffix(suffix)}(float value) {`,
        `  return map_color_s_2d(colorscale${suffix}, color_range${suffix}, 0.0/0.0, color_scale_type${suffix}, 0.0,`,
        `                        colorscale${suffix}, color_range${suffix}, value, color_scale_type${suffix}, alpha_blend${suffix});`,
        `}`
      )
      fragSrc = removeUniformDecl(fragSrc, `colorscale${suffix}`)
      fragSrc = removeUniformDecl(fragSrc, `color_range${suffix}`)
      fragSrc = removeUniformDecl(fragSrc, `color_scale_type${suffix}`)
      fragSrc = removeUniformDecl(fragSrc, `alpha_blend${suffix}`)
    }
    const colorHelpers = colorHelperLines.join('\n')

    const color2dHelperLines = []
    for (const [suffix2d, [s1, s2]] of Object.entries(layer.colorAxes2d)) {
      color2dHelperLines.push(
        `vec4 map_color_2d_${fnSuffix(suffix2d)}(vec2 values) {`,
        `  return map_color_s_2d(colorscale${s1}, color_range${s1}, values.x, color_scale_type${s1}, alpha_blend${s1},`,
        `                        colorscale${s2}, color_range${s2}, values.y, color_scale_type${s2}, alpha_blend${s2});`,
        `}`
      )
    }
    const color2dHelpers = color2dHelperLines.join('\n')

    const filterHelperLines = []
    for (const [suffix] of Object.entries(layer.filterAxes)) {
      filterHelperLines.push(
        `uniform vec4 filter_range${suffix};`,
        `bool filter_${fnSuffix(suffix)}(float value) {`,
        `  return filter_in_range(filter_range${suffix}, value);`,
        `}`
      )
      vertSrc = removeUniformDecl(vertSrc, `filter_range${suffix}`)
    }
    const filterHelpers = filterHelperLines.join('\n')

    const drawConfig = {
      vert: injectPickIdAssignment(injectInto(vertSrc, [spatialGlsl, filterGlsl, filterHelpers, columnHelpers, pickVertDecls])),
      frag: injectInto(fragSrc, [buildApplyColorGlsl(), colorGlsl, colorHelpers, color2dHelpers, filterGlsl, filterHelpers]),
      attributes,
      uniforms,
      viewport: regl.prop("viewport"),
      primitive: layer.primitive,
      lineWidth: layer.lineWidth,
      count: regl.prop("count"),
      ...(Object.keys(layer.colorAxes).length > 0 || Object.keys(layer.colorAxes2d).length > 0
        ? { blend: { enable: true, func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 } } }
        : layer.blend ? { blend: layer.blend } : {})
    }

    if (layer.instanceCount !== null) {
      drawConfig.instances = regl.prop("instances")
    }

    return drawConfig
  }

  schema(data) {
    if (this._schema) return this._schema(data)
    throw new Error(`LayerType '${this.name}' does not implement schema()`)
  }

  resolveAxisConfig(parameters, data) {
    const resolved = {
      xAxis: this.xAxis,
      xAxisQuantityKind: this.xAxisQuantityKind,
      yAxis: this.yAxis,
      yAxisQuantityKind: this.yAxisQuantityKind,
      colorAxisQuantityKinds: { ...this.colorAxisQuantityKinds },
      colorAxis2dQuantityKinds: { ...this.colorAxis2dQuantityKinds },
      filterAxisQuantityKinds: { ...this.filterAxisQuantityKinds },
    }

    if (this._getAxisConfig) {
      const dynamic = this._getAxisConfig.call(this, parameters, data)
      if (dynamic.xAxis !== undefined)                   resolved.xAxis = dynamic.xAxis
      if (dynamic.xAxisQuantityKind !== undefined)       resolved.xAxisQuantityKind = dynamic.xAxisQuantityKind
      if (dynamic.yAxis !== undefined)                   resolved.yAxis = dynamic.yAxis
      if (dynamic.yAxisQuantityKind !== undefined)       resolved.yAxisQuantityKind = dynamic.yAxisQuantityKind
      if (dynamic.colorAxisQuantityKinds !== undefined)  resolved.colorAxisQuantityKinds = dynamic.colorAxisQuantityKinds
      if (dynamic.colorAxis2dQuantityKinds !== undefined) resolved.colorAxis2dQuantityKinds = dynamic.colorAxis2dQuantityKinds
      if (dynamic.filterAxisQuantityKinds !== undefined) resolved.filterAxisQuantityKinds = dynamic.filterAxisQuantityKinds
    }

    return resolved
  }

  createLayer(regl, parameters, data, plot) {
    if (!this._createLayer) {
      throw new Error(`LayerType '${this.name}' does not implement createLayer()`)
    }
    const gpuConfigs = this._createLayer.call(this, regl, parameters, data, plot)
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
      colorAxes2d: axisConfig.colorAxis2dQuantityKinds,
      filterAxes: axisConfig.filterAxisQuantityKinds,
    }))
  }
}
