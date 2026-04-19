import { parse } from '@loaders.gl/core'
import { GLTFLoader, postProcessGLTF } from '@loaders.gl/gltf'
import { LayerType } from '../core/LayerType.js'
import { Layer } from '../core/Layer.js'
import { registerLayerType } from '../core/LayerTypeRegistry.js'

// ── Geometry helpers ────────────────────────────────────────────────────────

function expandVec(src, indices, stride) {
  const out = new Float32Array(indices.length * stride)
  for (let i = 0; i < indices.length; i++)
    for (let c = 0; c < stride; c++)
      out[i * stride + c] = src[indices[i] * stride + c]
  return out
}

function flatNormals(count) {
  const a = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) a[i * 3 + 1] = 1
  return a
}

function expandPrimitive(prim) {
  const posAcc  = prim.attributes.POSITION
  const normAcc = prim.attributes.NORMAL
  const uvAcc   = prim.attributes.TEXCOORD_0
  const idxArr  = prim.indices?.value

  if (idxArr) {
    const count = idxArr.length
    const pos  = expandVec(posAcc.value,  idxArr, 3)
    const norm = normAcc ? expandVec(normAcc.value, idxArr, 3) : flatNormals(count)
    const uvs  = uvAcc   ? expandVec(uvAcc.value,   idxArr, 2) : null
    return { positions: pos, normals: norm, uvs, count }
  } else {
    const count = posAcc.count
    return {
      positions: posAcc.value,
      normals:   normAcc ? normAcc.value : flatNormals(count),
      uvs:       uvAcc ? uvAcc.value : null,
      count,
    }
  }
}

function resolveImage(material) {
  const bt = material?.pbrMetallicRoughness?.baseColorTexture
  if (!bt) return null
  return bt.index?.source?.image ?? null
}

function normalize3(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
  return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0, 1, 0]
}

// ── GLSL shaders ─────────────────────────────────────────────────────────────

const SPATIAL_VERT = `
uniform vec2 xDomain; uniform vec2 yDomain; uniform vec2 zDomain;
uniform float xScaleType; uniform float yScaleType; uniform float zScaleType;
uniform float u_is3D; uniform mat4 u_mvp;
out vec3 v_clip_pos;

float normalize_axis(float v, vec2 domain, float scaleType) {
  float vt = scaleType > 0.5 ? log(v) : v;
  float d0 = scaleType > 0.5 ? log(domain.x) : domain.x;
  float d1 = scaleType > 0.5 ? log(domain.y) : domain.y;
  return (vt - d0) / (d1 - d0);
}
vec4 plot_pos_3d(vec3 pos) {
  float nx = normalize_axis(pos.x, xDomain, xScaleType);
  float ny = normalize_axis(pos.y, yDomain, yScaleType);
  float nz = normalize_axis(pos.z, zDomain, zScaleType);
  v_clip_pos = vec3(nx, ny, nz);
  return u_mvp * vec4(nx*2.0-1.0, ny*2.0-1.0, nz*2.0-1.0, 1.0);
}`

const GLTF_VERT_NO_TEX = `#version 300 es
precision mediump float;

in vec3 a_position;
in vec3 a_normal;
in float a_pickId;

uniform vec3 u_center;

${SPATIAL_VERT}

out vec3 v_normal;
out float v_pickId;

void main() {
  gl_Position = plot_pos_3d(a_position + u_center);
  v_normal  = normalize(a_normal);
  v_pickId  = a_pickId;
}`

const GLTF_VERT_TEX = `#version 300 es
precision mediump float;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in float a_pickId;

uniform vec3 u_center;

${SPATIAL_VERT}

out vec3 v_normal;
out vec2 v_uv;
out float v_pickId;

void main() {
  gl_Position = plot_pos_3d(a_position + u_center);
  v_normal  = normalize(a_normal);
  v_uv      = a_uv;
  v_pickId  = a_pickId;
}`

const GLTF_FRAG_NO_TEX = `#version 300 es
precision mediump float;

in vec3  v_clip_pos;
in vec3  v_normal;
in float v_pickId;

uniform float u_is3D;
uniform vec4  u_baseColorFactor;
uniform vec3  u_emissiveFactor;
uniform vec3  u_lightDir;
uniform float u_ambientStrength;
uniform float u_pickingMode;
uniform float u_pickLayerIndex;

out vec4 fragColor;

vec4 gladly_apply_color(vec4 color) {
  if (u_pickingMode > 0.5) {
    float li = u_pickLayerIndex + 1.0;
    float di = floor(v_pickId + 0.5);
    return vec4(li/255.0,
                floor(di/65536.0)/255.0,
                floor(mod(di,65536.0)/256.0)/255.0,
                mod(di,256.0)/255.0);
  }
  return color;
}

void main() {
  if (u_is3D > 0.5 &&
      (v_clip_pos.x < 0.0 || v_clip_pos.x > 1.0 ||
       v_clip_pos.y < 0.0 || v_clip_pos.y > 1.0 ||
       v_clip_pos.z < 0.0 || v_clip_pos.z > 1.0)) discard;

  vec4 base = u_baseColorFactor;

  vec3  N     = normalize(v_normal);
  float diff  = max(dot(N, normalize(u_lightDir)), 0.0);
  float light = u_ambientStrength + (1.0 - u_ambientStrength) * diff;
  vec3  rgb   = base.rgb * light + u_emissiveFactor;

  fragColor = gladly_apply_color(vec4(rgb, base.a));
}`

const GLTF_FRAG_TEX = `#version 300 es
precision mediump float;

in vec3  v_clip_pos;
in vec3  v_normal;
in vec2  v_uv;
in float v_pickId;

uniform float u_is3D;
uniform vec4  u_baseColorFactor;
uniform sampler2D u_baseColorTex;
uniform vec3  u_emissiveFactor;
uniform vec3  u_lightDir;
uniform float u_ambientStrength;
uniform float u_pickingMode;
uniform float u_pickLayerIndex;

out vec4 fragColor;

vec4 gladly_apply_color(vec4 color) {
  if (u_pickingMode > 0.5) {
    float li = u_pickLayerIndex + 1.0;
    float di = floor(v_pickId + 0.5);
    return vec4(li/255.0,
                floor(di/65536.0)/255.0,
                floor(mod(di,65536.0)/256.0)/255.0,
                mod(di,256.0)/255.0);
  }
  return color;
}

void main() {
  if (u_is3D > 0.5 &&
      (v_clip_pos.x < 0.0 || v_clip_pos.x > 1.0 ||
       v_clip_pos.y < 0.0 || v_clip_pos.y > 1.0 ||
       v_clip_pos.z < 0.0 || v_clip_pos.z > 1.0)) discard;

  vec4 base = u_baseColorFactor * texture(u_baseColorTex, v_uv);

  vec3  N     = normalize(v_normal);
  float diff  = max(dot(N, normalize(u_lightDir)), 0.0);
  float light = u_ambientStrength + (1.0 - u_ambientStrength) * diff;
  vec3  rgb   = base.rgb * light + u_emissiveFactor;

  fragColor = gladly_apply_color(vec4(rgb, base.a));
}`

// ── GltfLayerType ─────────────────────────────────────────────────────────────

class GltfLayerType extends LayerType {
  constructor() {
    super({
      name: 'gltf',
      vert: '',
      frag: '',
      attributes: {},
      uniforms:   {},
    })
    this.suppressWarnings = true
  }

  resolveAxisConfig(parameters, _data) {
    return {
      xAxis: parameters.xAxis ?? 'xaxis_bottom',
      xAxisQuantityKind: parameters.xAxisQuantityKind ?? 'distance_meters_x',
      yAxis: parameters.yAxis ?? 'yaxis_left',
      yAxisQuantityKind: parameters.yAxisQuantityKind ?? 'distance_meters_y',
      zAxis: parameters.zAxis ?? 'zaxis_bottom_left',
      zAxisQuantityKind: parameters.zAxisQuantityKind ?? 'distance_meters_z',
      colorAxisQuantityKinds:   {},
      colorAxis2dQuantityKinds: {},
      filterAxisQuantityKinds:  {},
    }
  }

  async createLayer(regl, parameters, _data, plot) {
    const { xAxis, yAxis, zAxis, xAxisQuantityKind, yAxisQuantityKind, zAxisQuantityKind } = this.resolveAxisConfig(parameters, _data)

    // Load GLTF (fetch manually so blob: URLs work — loaders.gl can't fetch them)
    const arrayBuffer = await fetch(parameters.url).then(r => r.arrayBuffer())
    const raw  = await parse(arrayBuffer, GLTFLoader, { gltf: { loadImages: true } })
    const gltf = postProcessGLTF(raw)

    // CESIUM_RTC center
    const center = (
      raw.json?.extensions?.CESIUM_RTC?.center ??
      raw.json?.extras?.CESIUM_RTC?.center ??
      [0, 0, 0]
    )

    const lightDir        = normalize3(parameters.lightDir ?? [0.3, 1.0, 0.3])
    const ambientStrength = parameters.ambientStrength ?? 0.3

    // Build one regl command per primitive, collect under _gltfCmds
    const cmds = []

    for (const mesh of (gltf.meshes ?? [])) {
      for (const prim of (mesh.primitives ?? [])) {
        const { positions, normals, uvs, count } = expandPrimitive(prim)

        const material    = prim.material ?? {}
        const pbr         = material.pbrMetallicRoughness ?? {}
        const alphaMode   = material.alphaMode ?? 'OPAQUE'
        const doubleSided = material.doubleSided ?? false
        const image       = resolveImage(material)
        const hasTexture  = !!(uvs && image)

        let texture = null
        if (hasTexture) {
          texture = regl.texture({ data: image, flipY: true, min: 'linear', mag: 'linear' })
        }

        // build pick ID array (one per vertex, all same primitive index)
        const primIndex = cmds.length
        const pickIds = new Float32Array(count)
        pickIds.fill(primIndex)

        const cmd = regl({
          vert: hasTexture ? GLTF_VERT_TEX : GLTF_VERT_NO_TEX,
          frag: hasTexture ? GLTF_FRAG_TEX : GLTF_FRAG_NO_TEX,
          attributes: {
            a_position: { buffer: regl.buffer(positions), size: 3 },
            a_normal:   { buffer: regl.buffer(normals),   size: 3 },
            ...(hasTexture ? { a_uv: { buffer: regl.buffer(uvs), size: 2 } } : {}),
            a_pickId:   regl.buffer(pickIds),
          },
          uniforms: {
            xDomain:          regl.prop('xDomain'),
            yDomain:          regl.prop('yDomain'),
            zDomain:          regl.prop('zDomain'),
            xScaleType:       regl.prop('xScaleType'),
            yScaleType:       regl.prop('yScaleType'),
            zScaleType:       regl.prop('zScaleType'),
            u_is3D:           regl.prop('u_is3D'),
            u_mvp:            regl.prop('u_mvp'),
            u_pickingMode:    regl.prop('u_pickingMode'),
            u_pickLayerIndex: regl.prop('u_pickLayerIndex'),
            u_center:          center,
            u_baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
            u_emissiveFactor:  material.emissiveFactor ?? [0, 0, 0],
            u_lightDir:        lightDir,
            u_ambientStrength: ambientStrength,
            ...(hasTexture ? { u_baseColorTex: texture } : {}),
          },
          count,
          primitive: 'triangles',
          viewport:  regl.prop('viewport'),
          depth:     { enable: true },
          cull:      { enable: !doubleSided, face: 'back' },
          blend: alphaMode === 'BLEND'
            ? { enable: true, func: { src: 'src alpha', dst: 'one minus src alpha' } }
            : { enable: false },
        })

        cmds.push(cmd)
      }
    }

    const totalCount = cmds.length > 0
      ? gltf.meshes.reduce((s, m) => s + m.primitives.reduce((ps, p) => {
          const idx = p.indices?.value
          return ps + (idx ? idx.length : p.attributes.POSITION.count)
        }, 0), 0)
      : 0

    const layer = new Layer({
      type: this,
      attributes: {},
      uniforms:   {},
      vertexCount: totalCount,
      primitive:  'triangles',
      xAxis, yAxis, zAxis,
      xAxisQuantityKind,
      yAxisQuantityKind,
      zAxisQuantityKind,
      colorAxes: {}, colorAxes2d: {}, filterAxes: {},
      domains: {},
    })
    layer._gltfCmds = cmds

    return [layer]
  }

  createDrawCommand(_regl, layer, _plot) {
    return (runtimeProps) => {
      for (const cmd of (layer._gltfCmds ?? [])) {
        cmd(runtimeProps)
      }
    }
  }
}

const gltfLayerType = new GltfLayerType()
registerLayerType('gltf', gltfLayerType)
export default gltfLayerType
