import { Plot } from "../src/index.js"
import '../src/layers/GltfLayer.js'

// ── Procedural house GLB ──────────────────────────────────────────────────────

function makeHouseGlb() {
  const wallPos = [], wallNorm = []
  const roofPos = [], roofNorm = []

  function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
  }
  function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]] }
  function normalize(v) {
    const l = Math.sqrt(v[0]**2+v[1]**2+v[2]**2)
    return l > 0 ? [v[0]/l, v[1]/l, v[2]/l] : [0,1,0]
  }

  function addTri(pArr, nArr, p0, p1, p2) {
    const n = normalize(cross(sub(p1,p0), sub(p2,p0)))
    pArr.push(...p0, ...p1, ...p2)
    nArr.push(...n, ...n, ...n)
  }

  function addQuad(pArr, nArr, p0, p1, p2, p3) {
    addTri(pArr, nArr, p0, p1, p2)
    addTri(pArr, nArr, p0, p2, p3)
  }

  // Box walls: x [-2.5, 2.5], y [0, 4], z [-2.5, 2.5]
  addQuad(wallPos, wallNorm, [-2.5,0,2.5], [2.5,0,2.5], [2.5,4,2.5], [-2.5,4,2.5])    // front
  addQuad(wallPos, wallNorm, [2.5,0,-2.5], [-2.5,0,-2.5], [-2.5,4,-2.5], [2.5,4,-2.5]) // back
  addQuad(wallPos, wallNorm, [-2.5,0,-2.5], [-2.5,0,2.5], [-2.5,4,2.5], [-2.5,4,-2.5]) // left
  addQuad(wallPos, wallNorm, [2.5,0,2.5], [2.5,0,-2.5], [2.5,4,-2.5], [2.5,4,2.5])     // right
  addQuad(wallPos, wallNorm, [-2.5,4,2.5], [2.5,4,2.5], [2.5,4,-2.5], [-2.5,4,-2.5])   // top of walls

  // Pyramid roof: base [-3,3] at y=4, apex at (0,6,0)
  addTri(roofPos, roofNorm, [-3,4,3], [3,4,3], [0,6,0])    // front
  addTri(roofPos, roofNorm, [3,4,3], [3,4,-3], [0,6,0])    // right
  addTri(roofPos, roofNorm, [3,4,-3], [-3,4,-3], [0,6,0])  // back
  addTri(roofPos, roofNorm, [-3,4,-3], [-3,4,3], [0,6,0])  // left

  const wallCount = wallPos.length / 3   // 30
  const roofCount = roofPos.length / 3   // 12

  function toF32(arr) { return new Float32Array(arr) }

  const wPos = toF32(wallPos), wNrm = toF32(wallNorm)
  const rPos = toF32(roofPos), rNrm = toF32(roofNorm)

  const wPosLen = wPos.byteLength, wNrmLen = wNrm.byteLength
  const rPosLen = rPos.byteLength, rNrmLen = rNrm.byteLength
  const totalBin = wPosLen + wNrmLen + rPosLen + rNrmLen

  // Pack all float data into one buffer
  const bin = new Uint8Array(totalBin)
  let off = 0
  const wPosOff = off; bin.set(new Uint8Array(wPos.buffer), off); off += wPosLen
  const wNrmOff = off; bin.set(new Uint8Array(wNrm.buffer), off); off += wNrmLen
  const rPosOff = off; bin.set(new Uint8Array(rPos.buffer), off); off += rPosLen
  const rNrmOff = off; bin.set(new Uint8Array(rNrm.buffer), off); off += rNrmLen

  function minMax(arr) {
    let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
    for (let i = 0; i < arr.length; i += 3)
      for (let c = 0; c < 3; c++) {
        if (arr[i+c] < min[c]) min[c] = arr[i+c]
        if (arr[i+c] > max[c]) max[c] = arr[i+c]
      }
    return { min, max }
  }

  const wBB = minMax(wallPos), rBB = minMax(roofPos)

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 },
        { attributes: { POSITION: 2, NORMAL: 3 }, material: 1, mode: 4 },
      ]
    }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.85, 0.55, 0.30, 1.0] } },
      { pbrMetallicRoughness: { baseColorFactor: [0.40, 0.22, 0.10, 1.0] } },
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: wallCount, type: "VEC3", min: wBB.min, max: wBB.max },
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: wallCount, type: "VEC3" },
      { bufferView: 2, byteOffset: 0, componentType: 5126, count: roofCount, type: "VEC3", min: rBB.min, max: rBB.max },
      { bufferView: 3, byteOffset: 0, componentType: 5126, count: roofCount, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: wPosOff, byteLength: wPosLen },
      { buffer: 0, byteOffset: wNrmOff, byteLength: wNrmLen },
      { buffer: 0, byteOffset: rPosOff, byteLength: rPosLen },
      { buffer: 0, byteOffset: rNrmOff, byteLength: rNrmLen },
    ],
    buffers: [{ byteLength: totalBin }]
  }

  // Pad JSON to 4-byte boundary with spaces
  let jsonStr = JSON.stringify(json)
  while (jsonStr.length % 4 !== 0) jsonStr += ' '
  const jsonBytes = new TextEncoder().encode(jsonStr)

  // Pad binary to 4-byte boundary with zeros
  const binPadLen = Math.ceil(totalBin / 4) * 4
  const binPad = new Uint8Array(binPadLen)
  binPad.set(bin)

  const totalLen = 12 + 8 + jsonBytes.length + 8 + binPadLen
  const glb = new Uint8Array(totalLen)
  const view = new DataView(glb.buffer)

  let p = 0
  view.setUint32(p, 0x46546C67, true); p += 4  // "glTF"
  view.setUint32(p, 2, true);          p += 4  // version
  view.setUint32(p, totalLen, true);   p += 4  // total length

  view.setUint32(p, jsonBytes.length, true); p += 4
  view.setUint32(p, 0x4E4F534A, true);       p += 4  // "JSON"
  glb.set(jsonBytes, p); p += jsonBytes.length

  view.setUint32(p, binPadLen, true); p += 4
  view.setUint32(p, 0x004E4942, true); p += 4  // "BIN\0"
  glb.set(binPad, p)

  return glb
}

// ── Tab setup ────────────────────────────────────────────────────────────────

{
  const panel = document.createElement('div')
  panel.id = 'tab8'
  panel.className = 'tab-content'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="plots-container">
      <div>
        <div class="plot-header">
          <h3>GLTF Model (procedural house)</h3>
        </div>
        <div id="tab8-plot1" class="plot-panel active"></div>
      </div>
    </div>
    <div class="editor-panel">
      <div class="info">
        A procedurally-generated GLB model (house + pyramid roof) loaded via
        <code>GltfLayer</code>. Drag to orbit, scroll to zoom.
      </div>
      <div id="tab8-status" class="validation-error" style="display:none"></div>
    </div>
  `
  document.body.appendChild(panel)
  const pickStatus = document.createElement('div')
  pickStatus.id = 'tab8-pick-status'
  pickStatus.className = 'pick-status'
  pickStatus.style.display = 'none'
  document.body.appendChild(pickStatus)
}

const _panel_tab8 = document.getElementById('tab8')

const _doInit_tab8 = async () => {
  const glbBytes = makeHouseGlb()
  const url = URL.createObjectURL(new Blob([glbBytes], { type: 'model/gltf-binary' }))

  const plotConfig = {
    layers: [
      {
        gltf: {
          url,
          xAxis: 'xaxis_bottom',
          yAxis: 'yaxis_left',
          zAxis: 'zaxis_bottom_left',
          lightDir: [0.5, 1.0, 0.5],
          ambientStrength: 0.35,
        }
      }
    ],
    axes: {
      xaxis_bottom:       { min: -4, max: 4 },
      yaxis_left:         { min: -0.5, max: 7 },
      zaxis_bottom_left:  { min: -4, max: 4 },
    },
  }

  const plot = new Plot(document.getElementById('tab8-plot1'))

  try {
    await plot.update({ config: plotConfig, data: {} })
  } catch (err) {
    console.error(err)
    const s = document.getElementById('tab8-status')
    s.textContent = String(err)
    s.style.display = ''
  }
}

if (_panel_tab8.style.display !== 'none') {
  _doInit_tab8()
} else {
  const _obs = new MutationObserver(() => {
    if (_panel_tab8.style.display !== 'none') { _obs.disconnect(); _doInit_tab8() }
  })
  _obs.observe(_panel_tab8, { attributes: true, attributeFilter: ['style'] })
}
