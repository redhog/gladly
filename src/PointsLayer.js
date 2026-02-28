import { ScatterLayerTypeBase } from "./ScatterShared.js"
import { Data } from "./Data.js"
import { registerLayerType } from "./LayerTypeRegistry.js"

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
    ${hasFilter ? 'if (!filter_in_range(filter_range, filter_data)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }' : ''}
    float nx = normalize_axis(x, xDomain, xScaleType);
    float ny = normalize_axis(y, yDomain, yScaleType);
    gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
    gl_PointSize = 4.0;
    value = color_data;
    value2 = color_data2;
  }
`
}

const POINTS_FRAG = `
  precision mediump float;
  uniform int colorscale;
  uniform vec2 color_range;
  uniform float color_scale_type;

  uniform int colorscale2;
  uniform vec2 color_range2;
  uniform float color_scale_type2;

  uniform float alphaBlend;
  uniform float u_useSecondColor;

  varying float value;
  varying float value2;

  void main() {
    if (u_useSecondColor > 0.5) {
      gl_FragColor = map_color_s_2d(
        colorscale, color_range, value, color_scale_type,
        colorscale2, color_range2, value2, color_scale_type2
      );
      if (alphaBlend > 0.5) {
        gl_FragColor.a *= gl_FragColor.a;
      }
    } else {
      gl_FragColor = map_color_s(colorscale, color_range, value, color_scale_type, alphaBlend);
    }
  }
`

class PointsLayerType extends ScatterLayerTypeBase {
  constructor() {
    super({ name: "points", vert: makePointsVert(false), frag: POINTS_FRAG })
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
    const { xData, yData, vData, vData2, fData, alphaBlend, xQK, yQK, vQK, vQK2, fQK, srcX, srcY, srcV, srcV2, srcF } =
      this._resolveColorData(parameters, d)

    const useSecond = vData2 ? 1.0 : 0.0
    const domains = this._buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2)
    const blendConfig = this._buildBlendConfig(alphaBlend)

    return [{
      attributes: {
        x: srcX,
        y: srcY,
        color_data: vData ? srcV : new Float32Array(srcX.length),
        color_data2: vData2 ? srcV2 : new Float32Array(srcX.length),
        ...(fData ? { filter_data: srcF } : {}),
      },
      uniforms: {
        alphaBlend: alphaBlend ? 1.0 : 0.0,
        u_useSecondColor: useSecond,
        ...(vData ? {} : { colorscale: 0, color_range: [0, 1], color_scale_type: 0.0 }),
        ...(vData2 ? {} : { colorscale2: 0, color_range2: [0, 1], color_scale_type2: 0.0 })
      },
      domains,
      nameMap: this._buildNameMap(vData, vQK, vData2, vQK2, fData, fQK),
      blend: blendConfig,
    }]
  }

  createDrawCommand(regl, layer) {
    const hasFilter = layer.filterAxes.length > 0
    this.vert = makePointsVert(hasFilter)
    return super.createDrawCommand(regl, layer)
  }
}

export const pointsLayerType = new PointsLayerType()
registerLayerType("points", pointsLayerType)
