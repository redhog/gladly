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
    const dataProperties = Data.wrap(data).columns()
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: this._commonSchemaProperties(dataProperties),
      required: ["xData", "yData", "vData"]
    }
  }

  _createLayer(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, vData2, fData, xQK, yQK, vQK, vQK2, fQK, srcX, srcY, srcV, srcV2, srcF } =
      this._resolveColorData(parameters, d)

    const domains = this._buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2)

    return [{
      attributes: {
        x: srcX,
        y: srcY,
        color_data: vData ? srcV : new Float32Array(srcX.length),
        color_data2: vData2 ? srcV2 : new Float32Array(srcX.length),
        ...(fData ? { filter_data: srcF } : {}),
      },
      uniforms: {},
      domains,
    }]
  }

  createDrawCommand(regl, layer) {
    const hasFilter = Object.keys(layer.filterAxes).length > 0
    const hasSecond = Object.keys(layer.colorAxes2d).length > 0
    this.vert = makePointsVert(hasFilter)
    this.frag = makePointsFrag(hasSecond)
    return super.createDrawCommand(regl, layer)
  }
}

export const pointsLayerType = new PointsLayerType()
registerLayerType("points", pointsLayerType)
