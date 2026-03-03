import { LayerType } from "../core/LayerType.js"
import { AXES } from "../axes/AxisRegistry.js"
import { Data } from "../core/Data.js"
import { computationSchema, EXPRESSION_REF, EXPRESSION_REF_OPT, resolveQuantityKind } from "../compute/ComputationRegistry.js"

export class ScatterLayerTypeBase extends LayerType {
  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData: vDataRaw, vData2: vData2Raw, fData: fDataRaw, xAxis, yAxis } = parameters
    const vData  = vDataRaw  === "none" ? null : vDataRaw
    const vData2 = vData2Raw === "none" ? null : vData2Raw
    const fData  = fDataRaw  === "none" ? null : fDataRaw
    const colorAxisQuantityKinds = {}
    const vQK  = vData  ? resolveQuantityKind(vData,  d) : null
    const vQK2 = vData2 ? resolveQuantityKind(vData2, d) : null
    if (vQK)  colorAxisQuantityKinds['']  = vQK
    if (vQK2) colorAxisQuantityKinds['2'] = vQK2
    const colorAxis2dQuantityKinds = vData && vData2 ? { '': ['', '2'] } : {}
    const filterAxisQuantityKinds = fData ? { '': resolveQuantityKind(fData, d) } : {}
    return {
      xAxis,
      xAxisQuantityKind: resolveQuantityKind(xData, d) ?? undefined,
      yAxis,
      yAxisQuantityKind: resolveQuantityKind(yData, d) ?? undefined,
      colorAxisQuantityKinds,
      colorAxis2dQuantityKinds,
      filterAxisQuantityKinds,
    }
  }

  // Returns schema properties for the common data parameters.
  // All data params use EXPRESSION_REF or EXPRESSION_REF_OPT — the caller must hoist
  // computationSchema(data)['$defs'] to the top-level schema so that
  // '#/$defs/expression' (and all nested refs within it) resolve correctly.
  // LinesLayer overrides fData to a plain string enum since it needs CPU-side subarray slicing.
  _commonSchemaProperties(data) {
    const d = Data.wrap(data)
    return {
      xData: EXPRESSION_REF,
      yData: EXPRESSION_REF,
      vData: EXPRESSION_REF,
      vData2: EXPRESSION_REF,
      fData: EXPRESSION_REF_OPT,
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
    }
  }

  // Resolves column-name params to Float32Arrays. Used by LinesLayer which needs to
  // slice adjacent-point pairs via subarray(). xData/yData/fData must be column name strings.
  _resolveColorData(parameters, d) {
    const { xData, yData, vData: vDataOrig, vData2: vData2Orig, fData: fDataOrig } = parameters
    const vData = vDataOrig == "none" ? null : vDataOrig
    const vData2 = vData2Orig == "none" ? null : vData2Orig
    const fData = fDataOrig == "none" ? null : fDataOrig

    const xQK = d.getQuantityKind(xData) ?? xData
    const yQK = d.getQuantityKind(yData) ?? yData
    const vQK = vData ? resolveQuantityKind(vData, d) : null
    const vQK2 = vData2 ? resolveQuantityKind(vData2, d) : null
    const fQK = fData ? (d.getQuantityKind(fData) ?? fData) : null

    const srcX = d.getData(xData)
    const srcY = d.getData(yData)
    const srcV = vData && typeof vData === 'string' ? d.getData(vData) : null
    const srcV2 = vData2 && typeof vData2 === 'string' ? d.getData(vData2) : null
    const srcF = fData ? d.getData(fData) : null

    if (!srcX) throw new Error(`Data column '${xData}' not found`)
    if (!srcY) throw new Error(`Data column '${yData}' not found`)
    if (vData && typeof vData === 'string' && !srcV) throw new Error(`Data column '${vData}' not found`)
    if (vData2 && typeof vData2 === 'string' && !srcV2) throw new Error(`Data column '${vData2}' not found`)
    if (fData && !srcF) throw new Error(`Data column '${fData}' not found`)

    return { xData, yData, vData, vData2, fData, xQK, yQK, vQK, vQK2, fQK, srcX, srcY, srcV, srcV2, srcF }
  }

  _buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2) {
    const domains = {}

    if (xQK) {
      const xDomain = d.getDomain(xData)
      if (xDomain) domains[xQK] = xDomain
    }

    if (yQK) {
      const yDomain = d.getDomain(yData)
      if (yDomain) domains[yQK] = yDomain
    }

    if (vData && vQK) {
      const vDomain = d.getDomain(vData)
      if (vDomain) domains[vQK] = vDomain
    }

    if (vData2 && vQK2) {
      const vDomain2 = d.getDomain(vData2)
      if (vDomain2) domains[vQK2] = vDomain2
    }

    return domains
  }
}
