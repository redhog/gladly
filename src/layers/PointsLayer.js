import { ScatterLayerTypeBase } from "./ScatterShared.js"
import { Data } from "../core/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"
import { resolveQuantityKind } from "../compute/ComputationRegistry.js"

function makePointsVert(hasFilter) {
  return `#version 300 es
  precision mediump float;
  in float x;
  in float y;
  in float color_data;
  in float color_data2;
  ${hasFilter ? 'in float filter_data;' : ''}
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  out float value;
  out float value2;
  void main() {
    ${hasFilter ? 'if (!filter_(filter_data)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }' : ''}
    gl_Position = plot_pos(vec2(x, y));
    gl_PointSize = 4.0;
    value = color_data;
    value2 = color_data2;
  }
`
}

function makePointsFrag(hasFirst, hasSecond) {
  return `#version 300 es
  precision mediump float;
  in float value;
  in float value2;
  void main() {
    ${hasFirst
       ? (hasSecond
           ? 'fragColor = map_color_2d_(vec2(value, value2));'
           : 'fragColor = map_color_2d_x_(value);')
       : (hasSecond
           ? 'fragColor = map_color_2d_y_2(value2);'
           : 'fragColor = vec4(0.0, 0.0, 0.0, 1.0);')}
  }
`
}

class PointsLayerType extends ScatterLayerTypeBase {
  constructor() {
    super({ name: "points", vert: makePointsVert(false), frag: makePointsFrag(false) })
  }

  schema(data) {
    const d = Data.wrap(data)
    return {
      type: "object",
      properties: this._commonSchemaProperties(d),
      required: ["xData", "yData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const { vData: vDataRaw, vData2: vData2Raw, fData: fDataRaw } = parameters
    const vDataIn  = (vDataRaw  == null || vDataRaw  === "none") ? null : vDataRaw
    const vData2In = (vData2Raw == null || vData2Raw === "none") ? null : vData2Raw
    const fData    = (fDataRaw  == null || fDataRaw  === "none") ? null : fDataRaw
    const vData  = vDataIn
    const vData2 = vData2In

    const xQK  = resolveQuantityKind(parameters.xData, d) ?? undefined
    const yQK  = resolveQuantityKind(parameters.yData, d) ?? undefined
    const vQK  = vData  ? resolveQuantityKind(vData,  d) : null
    const vQK2 = vData2 ? resolveQuantityKind(vData2, d) : null

    const domains = this._buildDomains(d, parameters.xData, parameters.yData, vData, vData2, xQK, yQK, vQK, vQK2)

    // Vertex count: read from data when xData is a plain column name so that
    // Plot.render() can determine how many vertices to draw even when other
    // attributes are computed expressions resolved at draw time.
    const vertexCount = typeof parameters.xData === 'string'
      ? (d.getData(parameters.xData)?.length ?? null)
      : null

    return [{
      attributes: {
        x: parameters.xData,
        y: parameters.yData,
        color_data:  vData  !== null ? vData  : new Float32Array(vertexCount ?? 0).fill(NaN),
        color_data2: vData2 !== null ? vData2 : new Float32Array(vertexCount ?? 0).fill(NaN),
        ...(fData != null ? { filter_data: fData } : {}),
      },
      uniforms: {},
      domains,
      vertexCount,
    }]
  }

  createDrawCommand(regl, layer, plot) {
    const hasFilter = Object.keys(layer.filterAxes).length > 0
    const hasFirst = '' in layer.colorAxes
    const hasSecond = '2' in layer.colorAxes
    this.vert = makePointsVert(hasFilter)
    this.frag = makePointsFrag(hasFirst, hasSecond)
    return super.createDrawCommand(regl, layer, plot)
  }
}

export const pointsLayerType = new PointsLayerType()
registerLayerType("points", pointsLayerType)
