// Parser for the Cesium quantized-mesh terrain tile format.
// Spec: https://github.com/CesiumGS/quantized-mesh

export function parseQuantizedMesh(buffer) {
  const view = new DataView(buffer)
  const LE = true
  let offset = 0

  // Header: 88 bytes
  offset += 8 + 8 + 8            // centerX/Y/Z (skip)
  const minimumHeight = view.getFloat32(offset, LE); offset += 4
  const maximumHeight = view.getFloat32(offset, LE); offset += 4
  offset += 8 + 8 + 8 + 8        // boundingSphere center + radius (skip)
  offset += 8 + 8 + 8            // horizonOcclusionPoint (skip)
  // offset === 88 here

  const vertexCount = view.getUint32(offset, LE); offset += 4

  // Vertex data: three zigzag+delta-encoded uint16 arrays
  const uEncoded = new Uint16Array(buffer, offset, vertexCount); offset += vertexCount * 2
  const vEncoded = new Uint16Array(buffer, offset, vertexCount); offset += vertexCount * 2
  const hEncoded = new Uint16Array(buffer, offset, vertexCount); offset += vertexCount * 2

  function zigzagDelta(encoded, scale) {
    const out = new Float32Array(encoded.length)
    let acc = 0
    for (let i = 0; i < encoded.length; i++) {
      const c = encoded[i]
      acc += (c >> 1) ^ -(c & 1)
      out[i] = acc * scale
    }
    return out
  }

  const uArr = zigzagDelta(uEncoded, 1.0 / 32767.0)   // normalised [0,1]
  const vArr = zigzagDelta(vEncoded, 1.0 / 32767.0)
  const hNorm = zigzagDelta(hEncoded, 1.0 / 32767.0)  // [0,1] within height range

  const elevArr = new Float32Array(vertexCount)
  const heightRange = maximumHeight - minimumHeight
  for (let i = 0; i < vertexCount; i++) {
    elevArr[i] = minimumHeight + hNorm[i] * heightRange
  }

  // Align to 4-byte boundary before index data
  if (offset % 4 !== 0) offset += 4 - (offset % 4)

  const triangleCount = view.getUint32(offset, LE); offset += 4
  const indexCount = triangleCount * 3

  // Index buffer: uint32 when vertexCount > 65536, else uint16
  let encodedIndices
  if (vertexCount > 65536) {
    encodedIndices = new Uint32Array(buffer, offset, indexCount)
  } else {
    encodedIndices = new Uint16Array(buffer, offset, indexCount)
  }

  // High-watermark decode: encoded value 0 means "next new vertex"
  const indices = new Uint32Array(indexCount)
  let highest = 0
  for (let i = 0; i < indexCount; i++) {
    const code = encodedIndices[i]
    indices[i] = highest - code
    if (code === 0) highest++
  }

  return { vertexCount, triangleCount, u: uArr, v: vArr, elevation: elevArr, indices }
}
