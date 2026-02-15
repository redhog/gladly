export class Layer {
  constructor({ type, data, xAxis="xaxis_bottom", yAxis="yaxis_left" }) {
    if (!(data.x instanceof Float32Array)) throw "x must be Float32Array"
    if (!(data.y instanceof Float32Array)) throw "y must be Float32Array"
    if (data.v && !(data.v instanceof Float32Array)) throw "v must be Float32Array"

    this.type = type
    this.data = data
    this.xAxis = xAxis
    this.yAxis = yAxis
  }
}
