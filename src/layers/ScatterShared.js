import { LayerType } from "../core/LayerType.js"
import { AXIS_GEOMETRY } from "../axes/AxisRegistry.js"
import { Data } from "../data/Data.js"
import { computationSchema, EXPRESSION_REF, EXPRESSION_REF_OPT, resolveQuantityKind } from "../compute/ComputationRegistry.js"

const X_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'x')
const Y_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'y')
const Z_AXES = Object.keys(AXIS_GEOMETRY).filter(a => AXIS_GEOMETRY[a].dir === 'z')

export class ScatterLayerTypeBase extends LayerType {
  _getAxisConfig(parameters, data) {
    const d = Data.wrap(data)
    const {
      xData, yData, zData: zDataRaw,
      vData: vDataRaw, vData2: vData2Raw, fData: fDataRaw,
      xAxis = "xaxis_bottom", yAxis = "yaxis_left", zAxis = "none",
    } = parameters
    const vDataIn  = (vDataRaw  == null || vDataRaw  === "none") ? null : vDataRaw
    const vData2In = (vData2Raw == null || vData2Raw === "none") ? null : vData2Raw
    const fData    = (fDataRaw  == null || fDataRaw  === "none") ? null : fDataRaw
    const zData    = (zDataRaw  == null || zDataRaw  === "none") ? null : zDataRaw
    const zAxisResolved = (zAxis == null || zAxis === "none") ? null : zAxis
    const vData  = vDataIn
    const vData2 = vData2In
    const colorAxisQuantityKinds = {}
    const vQK  = vData  ? resolveQuantityKind(vData,  d) : null
    const vQK2 = vData2 ? resolveQuantityKind(vData2, d) : null
    if (vQK)  colorAxisQuantityKinds['']  = vQK
    if (vQK2) colorAxisQuantityKinds['2'] = vQK2
    const colorAxis2dQuantityKinds = vData && vData2 ? { '': ['', '2'] } : {}
    const filterAxisQuantityKinds  = fData ? { '': resolveQuantityKind(fData, d) } : {}
    return {
      xAxis,
      xAxisQuantityKind: resolveQuantityKind(xData, d) ?? undefined,
      yAxis,
      yAxisQuantityKind: resolveQuantityKind(yData, d) ?? undefined,
      zAxis: zData ? (zAxisResolved ?? "zaxis_bottom_left") : null,
      zAxisQuantityKind: zData ? (resolveQuantityKind(zData, d) ?? undefined) : undefined,
      colorAxisQuantityKinds,
      colorAxis2dQuantityKinds,
      filterAxisQuantityKinds,
    }
  }

  _commonSchemaProperties(data) {
    return {
      xData: EXPRESSION_REF,
      yData: EXPRESSION_REF,
      zData: EXPRESSION_REF_OPT,
      vData: EXPRESSION_REF_OPT,
      vData2: EXPRESSION_REF_OPT,
      fData: EXPRESSION_REF_OPT,
      xAxis: {
        type: "string",
        enum: X_AXES,
        default: "xaxis_bottom",
        description: "Which x-axis to use for this layer",
      },
      yAxis: {
        type: "string",
        enum: Y_AXES,
        default: "yaxis_left",
        description: "Which y-axis to use for this layer",
      },
      zAxis: {
        type: "string",
        enum: ["none", ...Z_AXES],
        default: "none",
        description: "Which z-axis to use for this layer (enables 3D mode)",
      },
    }
  }

  _buildDomains(d, xData, yData, zData, vData, vData2, xQK, yQK, zQK, vQK, vQK2) {
    const domains = {}
    if (xQK && typeof xData === 'string') {
      const xDomain = d.getDomain(xData)
      if (xDomain) domains[xQK] = xDomain
    }
    if (yQK && typeof yData === 'string') {
      const yDomain = d.getDomain(yData)
      if (yDomain) domains[yQK] = yDomain
    }
    if (zData && zQK && typeof zData === 'string') {
      const zDomain = d.getDomain(zData)
      if (zDomain) domains[zQK] = zDomain
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
