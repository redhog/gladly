import { LayerType } from "./LayerType.js"
import { AXES } from "./AxisRegistry.js"
import { Data } from "./Data.js"

export class ScatterLayerTypeBase extends LayerType {
  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData, vData2, fData, xAxis, yAxis } = parameters
    const colorAxisQuantityKinds = [d.getQuantityKind(vData) ?? vData]
    if (vData2) {
      colorAxisQuantityKinds.push(d.getQuantityKind(vData2) ?? vData2)
    }
    const filterAxisQuantityKinds = fData ? [d.getQuantityKind(fData) ?? fData] : []
    return {
      xAxis,
      xAxisQuantityKind: d.getQuantityKind(xData) ?? xData,
      yAxis,
      yAxisQuantityKind: d.getQuantityKind(yData) ?? yData,
      colorAxisQuantityKinds,
      filterAxisQuantityKinds,
    }
  }

  _commonSchemaProperties(dataProperties) {
    return {
      xData: {
        type: "string",
        enum: dataProperties,
        description: "Property name in data object for x coordinates"
      },
      yData: {
        type: "string",
        enum: dataProperties,
        description: "Property name in data object for y coordinates"
      },
      vData: {
        type: "string",
        enum: ["none"].concat(dataProperties),
        description: "Primary property name in data object for color values"
      },
      vData2: {
        type: "string",
        enum: ["none"].concat(dataProperties),
        description: "Optional secondary property name for 2D color mapping"
      },
      fData: {
        type: "string",
        enum: ["none"].concat(dataProperties),
        description: "Optional property name for filter axis values"
      },
      xAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("x")),
        default: "xaxis_bottom",
        description: "Which x-axis to use for this layer"
      },
      yAxis: {
        type: "string",
        enum: AXES.filter(a => a.includes("y")),
        default: "yaxis_left",
        description: "Which y-axis to use for this layer"
      },
      alphaBlend: {
        type: "boolean",
        default: false,
        description: "Map the normalized color value to alpha so low values fade to transparent"
      },
    }
  }

  _resolveColorData(parameters, d) {
    const { xData, yData, vData: vDataOrig, vData2: vData2Orig, fData: fDataOrig, alphaBlend = false } = parameters
    const vData = vDataOrig == "none" ? null : vDataOrig
    const vData2 = vData2Orig == "none" ? null : vData2Orig
    const fData = fDataOrig == "none" ? null : fDataOrig

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData
    const vQK = vData ? (d.getQuantityKind(vData) ?? vData) : null
    const vQK2 = vData2 ? (d.getQuantityKind(vData2) ?? vData2) : null
    const fQK = fData ? (d.getQuantityKind(fData) ?? fData) : null

    const srcX = d.getData(xData)
    const srcY = d.getData(yData)
    const srcV = vData ? d.getData(vData) : null
    const srcV2 = vData2 ? d.getData(vData2) : null
    const srcF = fData ? d.getData(fData) : null

    if (!srcX) throw new Error(`Data column '${xData}' not found`)
    if (!srcY) throw new Error(`Data column '${yData}' not found`)
    if (vData && !srcV) throw new Error(`Data column '${vData}' not found`)
    if (vData2 && !srcV2) throw new Error(`Data column '${vData2}' not found`)
    if (fData && !srcF) throw new Error(`Data column '${fData}' not found`)

    return { xData, yData, vData, vData2, fData, alphaBlend, xQK, yQK, vQK, vQK2, fQK, srcX, srcY, srcV, srcV2, srcF }
  }

  _buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2) {
    const domains = {}

    const xDomain = d.getDomain(xData)
    if (xDomain) domains[xQK] = xDomain

    const yDomain = d.getDomain(yData)
    if (yDomain) domains[yQK] = yDomain

    if (vData) {
      const vDomain = d.getDomain(vData)
      if (vDomain) domains[vQK] = vDomain
    }

    if (vData2) {
      const vDomain2 = d.getDomain(vData2)
      if (vDomain2) domains[vQK2] = vDomain2
    }

    return domains
  }

  _buildNameMap(vData, vQK, vData2, vQK2, fData, fQK) {
    return {
      ...(vData ? {
        [`colorscale_${vQK}`]: 'colorscale',
        [`color_range_${vQK}`]: 'color_range',
        [`color_scale_type_${vQK}`]: 'color_scale_type',
      } : {}),
      ...(vData2 ? {
        [`colorscale_${vQK2}`]: 'colorscale2',
        [`color_range_${vQK2}`]: 'color_range2',
        [`color_scale_type_${vQK2}`]: 'color_scale_type2',
      } : {}),
      ...(fData ? { [`filter_range_${fQK}`]: 'filter_range' } : {}),
    }
  }

  _buildBlendConfig(alphaBlend) {
    return alphaBlend ? {
      enable: true,
      func: { srcRGB: 'src alpha', dstRGB: 'one minus src alpha', srcAlpha: 0, dstAlpha: 1 },
    } : null
  }
}
