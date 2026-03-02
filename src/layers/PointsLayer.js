import { ScatterLayerTypeBase } from "./ScatterShared.js"
import { Data } from "../core/Data.js"
import { registerLayerType } from "../core/LayerTypeRegistry.js"

function makePointsVert(hasFilter) {
  return `
  precision mediump float;
  attribute float x;
  attribute float y;
  attribute float color_data;
  attribute float color_data2;
  ${hasFilter ? 'attribute float filter_data;\n  uniform vec4 filter_range;' : ''}
  uniform vec2 xDomain;
  uniform vec2 yDomain;
  uniform float xScaleType;
  uniform float yScaleType;
  varying float value;
  varying float value2;
  void main() {
    ${hasFilter ? 'if (!filter_(filter_data)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }' : ''}
    gl_Position = plot_pos(vec2(x, y));
    gl_PointSize = 4.0;
    value = color_data;
    value2 = color_data2;
  }
`
}

function makePointsFrag(hasSecond) {
  return `
  precision mediump float;
  varying float value;
  varying float value2;
  void main() {
    ${hasSecond
      ? 'gl_FragColor = map_color_2d_(vec2(value, value2));'
      : 'gl_FragColor = map_color_(value);'}
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
      required: ["xData", "yData", "vData", "fData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const { vData: vDataRaw, vData2: vData2Raw, fData: fDataRaw } = parameters
    const vData  = vDataRaw  === "none" ? null : vDataRaw
    const vData2 = vData2Raw === "none" ? null : vData2Raw
    const fData  = fDataRaw  === "none" ? null : fDataRaw

    // Quantity kinds — only derivable from string column names.
    const xQK = typeof parameters.xData === 'string' ? (d.getQuantityKind(parameters.xData) ?? parameters.xData) : undefined
    const yQK = typeof parameters.yData === 'string' ? (d.getQuantityKind(parameters.yData) ?? parameters.yData) : undefined
    const vQK  = vData  && typeof vData  === 'string' ? (d.getQuantityKind(vData)  ?? vData)  : null
    const vQK2 = vData2 && typeof vData2 === 'string' ? (d.getQuantityKind(vData2) ?? vData2) : null

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
        color_data:  vData  !== null ? vData  : new Float32Array(vertexCount ?? 0),
        color_data2: vData2 !== null ? vData2 : new Float32Array(vertexCount ?? 0),
        ...(fData != null ? { filter_data: fData } : {}),
      },
      uniforms: {},
      domains,
      vertexCount,
    }]
  }

  createDrawCommand(regl, layer, plot) {
    const hasFilter = Object.keys(layer.filterAxes).length > 0
    const hasSecond = Object.keys(layer.colorAxes2d).length > 0
    this.vert = makePointsVert(hasFilter)
    this.frag = makePointsFrag(hasSecond)
    return super.createDrawCommand(regl, layer, plot)
  }
}

export const pointsLayerType = new PointsLayerType()
registerLayerType("points", pointsLayerType)
