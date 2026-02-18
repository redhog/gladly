import { Layer } from "./Layer.js"
import { buildColorGlsl } from "./ColorscaleRegistry.js"
import { buildFilterGlsl } from "./FilterAxisRegistry.js"

export class LayerType {
  constructor({ name, axisQuantityKinds, colorAxisQuantityKinds, filterAxisQuantityKinds, primitive, vert, frag, schema, createLayer, getAxisQuantityKinds, getColorAxisQuantityKinds, getFilterAxisQuantityKinds }) {
    this.name = name
    this.axisQuantityKinds = axisQuantityKinds
    this.primitive = primitive ?? "points"
    // colorAxisQuantityKinds: string[] — static quantity kinds for color slots (omit when dynamic)
    this.colorAxisQuantityKinds = colorAxisQuantityKinds ?? []
    // filterAxisQuantityKinds: string[] — static quantity kinds for filter slots (omit when dynamic)
    this.filterAxisQuantityKinds = filterAxisQuantityKinds ?? []
    this.vert = vert
    this.frag = frag

    if (schema) {
      this._schema = schema
    }
    if (createLayer) {
      this._createLayer = createLayer
    }
    if (getAxisQuantityKinds) {
      this._getAxisQuantityKinds = getAxisQuantityKinds
    }
    if (getColorAxisQuantityKinds) {
      this._getColorAxisQuantityKinds = getColorAxisQuantityKinds
    }
    if (getFilterAxisQuantityKinds) {
      this._getFilterAxisQuantityKinds = getFilterAxisQuantityKinds
    }
  }

  createDrawCommand(regl, layer) {
    const attributes = Object.fromEntries(
      Object.entries(layer.attributes).map(([key, buffer]) => [key, { buffer }])
    )

    const uniforms = {
      xDomain: regl.prop("xDomain"),
      yDomain: regl.prop("yDomain"),
      ...Object.fromEntries(
        Object.entries(layer.uniforms).map(([key, value]) => [key, value])
      )
    }

    // Add per-color-axis uniforms (colorscale index + range)
    for (const slot of Object.keys(layer.colorAxes)) {
      uniforms[`colorscale_${slot}`] = regl.prop(`colorscale_${slot}`)
      uniforms[`color_range_${slot}`] = regl.prop(`color_range_${slot}`)
    }

    // Add per-filter-axis uniforms (vec4: [min, max, hasMin, hasMax])
    for (const slot of Object.keys(layer.filterAxes)) {
      uniforms[`filter_range_${slot}`] = regl.prop(`filter_range_${slot}`)
    }

    // Inject GLSL helpers before the layer shader body.
    // Precision declarations must come first in a GLSL shader, so we hoist any
    // "precision ..." lines to the top, then insert the injected libraries, then
    // the remainder of the shader.
    const colorGlsl = Object.keys(layer.colorAxes).length > 0 ? buildColorGlsl() : ''
    const filterGlsl = Object.keys(layer.filterAxes).length > 0 ? buildFilterGlsl() : ''
    const injectGlsl = (src) => {
      const injected = [colorGlsl, filterGlsl].filter(Boolean).join('\n')
      if (!injected) return src
      const precisionRe = /^\s*precision\s+\S+\s+\S+\s*;\s*$/mg
      const precisions = src.match(precisionRe) ?? []
      const body = src.replace(precisionRe, '')
      return precisions.join('\n') + '\n' + injected + '\n' + body
    }
    const vert = injectGlsl(this.vert)
    const frag = injectGlsl(this.frag)

    return regl({
      vert,
      frag,
      attributes,
      uniforms,
      viewport: regl.prop("viewport"),
      primitive: this.primitive,
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
      const resolvedSpatial = this.resolveAxisQuantityKinds(parameters, data)
      const resolvedColor = this.resolveColorAxisQuantityKinds(parameters, data, config.colorAxes ?? {})
      const resolvedFilter = this.resolveFilterAxisQuantityKinds(parameters, data, config.filterAxes ?? {})
      return new Layer({
        type: this,
        ...config,
        xAxisQuantityKind: resolvedSpatial.x,
        yAxisQuantityKind: resolvedSpatial.y,
        colorAxes: resolvedColor,
        filterAxes: resolvedFilter
      })
    }
    throw new Error(`LayerType '${this.name}' does not implement createLayer()`)
  }

  getAxisQuantityKinds(parameters, data) {
    if (this._getAxisQuantityKinds) {
      return this._getAxisQuantityKinds.call(this, parameters, data)
    }
    throw new Error(`LayerType '${this.name}' does not implement getAxisQuantityKinds()`)
  }

  getColorAxisQuantityKinds(parameters, data) {
    if (this._getColorAxisQuantityKinds) {
      return this._getColorAxisQuantityKinds.call(this, parameters, data)
    }
    throw new Error(`LayerType '${this.name}' does not implement getColorAxisQuantityKinds()`)
  }

  getFilterAxisQuantityKinds(parameters, data) {
    if (this._getFilterAxisQuantityKinds) {
      return this._getFilterAxisQuantityKinds.call(this, parameters, data)
    }
    throw new Error(`LayerType '${this.name}' does not implement getFilterAxisQuantityKinds()`)
  }

  resolveAxisQuantityKinds(parameters, data) {
    let resolved = { ...this.axisQuantityKinds }

    if (resolved.x === null || resolved.y === null) {
      const dynamic = this.getAxisQuantityKinds(parameters, data)
      if (resolved.x === null) {
        if (dynamic.x === null || dynamic.x === undefined) {
          throw new Error(`LayerType '${this.name}' failed to resolve x axis quantity kind`)
        }
        resolved.x = dynamic.x
      }
      if (resolved.y === null) {
        if (dynamic.y === null || dynamic.y === undefined) {
          throw new Error(`LayerType '${this.name}' failed to resolve y axis quantity kind`)
        }
        resolved.y = dynamic.y
      }
    }

    return resolved
  }

  // Resolve color axis quantity kinds.
  // The factory's colorAxes object (slot -> { quantityKind, data }) is the source of truth;
  // colorAxisQuantityKinds and getColorAxisQuantityKinds are declarative hints only.
  resolveColorAxisQuantityKinds(parameters, data, factoryColorAxes) {
    return { ...factoryColorAxes }
  }

  // Resolve filter axis quantity kinds.
  // The factory's filterAxes object (slot -> { quantityKind, data }) is the source of truth;
  // filterAxisQuantityKinds and getFilterAxisQuantityKinds are declarative hints only.
  resolveFilterAxisQuantityKinds(parameters, data, factoryFilterAxes) {
    return { ...factoryFilterAxes }
  }
}
