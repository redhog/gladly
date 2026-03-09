import { LayerType } from "../core/LayerType.js"
import { AXES } from "../axes/AxisRegistry.js"
import { Data } from "../data/Data.js"
import { computationSchema, EXPRESSION_REF, EXPRESSION_REF_OPT, resolveQuantityKind } from "../compute/ComputationRegistry.js"

export class ScatterLayerTypeBase extends LayerType {
  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const { xData, yData, vData: vDataRaw, vData2: vData2Raw, fData: fDataRaw, xAxis = "xaxis_bottom", yAxis = "yaxis_left" } = parameters
    const vDataIn  = (vDataRaw  == null || vDataRaw  === "none") ? null : vDataRaw
    const vData2In = (vData2Raw == null || vData2Raw === "none") ? null : vData2Raw
    const fData    = (fDataRaw  == null || fDataRaw  === "none") ? null : fDataRaw
    const vData  = vDataIn
    const vData2 = vData2In
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
  _commonSchemaProperties(data) {
    const d = Data.wrap(data)
    return {
      xData: EXPRESSION_REF,
      yData: EXPRESSION_REF,
      vData: EXPRESSION_REF_OPT,
      vData2: EXPRESSION_REF_OPT,
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

  _buildDomains(d, xData, yData, vData, vData2, xQK, yQK, vQK, vQK2) {
    const domains = {}

    if (xQK && typeof xData === 'string') {
      const xDomain = d.getDomain(xData)
      if (xDomain) domains[xQK] = xDomain
    }

    if (yQK && typeof yData === 'string') {
      const yDomain = d.getDomain(yData)
      if (yDomain) domains[yQK] = yDomain
    }

    if (vData && vQK && typeof vData === 'string') {
      const vDomain = d.getDomain(vData)
      if (vDomain) domains[vQK] = vDomain
    }

    if (vData2 && vQK2 && typeof vData2 === 'string') {
      const vDomain2 = d.getDomain(vData2)
      if (vDomain2) domains[vQK2] = vDomain2
    }

    return domains
  }
}
