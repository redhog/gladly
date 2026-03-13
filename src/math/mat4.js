// Column-major 4×4 matrix utilities matching WebGL/GLSL convention.
// Element at row r, column c is stored at index c*4+r.

export function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ])
}

// a * b (left-multiplies a by b).
export function mat4Multiply(a, b) {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = s
    }
  }
  return out
}

// Perspective projection. fovY in radians, aspect = width/height.
export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0,  0,                    0,
    0,          f,  0,                    0,
    0,          0,  (far + near) * nf,   -1,
    0,          0,  2 * far * near * nf,  0,
  ])
}

// View matrix looking from eye toward center with the given up vector.
export function mat4LookAt(eye, center, up) {
  const f = vec3Normalize([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]])
  const r = vec3Normalize(vec3Cross(f, up))
  const u = vec3Cross(r, f)
  return new Float32Array([
     r[0],  u[0], -f[0], 0,
     r[1],  u[1], -f[1], 0,
     r[2],  u[2], -f[2], 0,
    -vec3Dot(r, eye), -vec3Dot(u, eye), vec3Dot(f, eye), 1,
  ])
}

// Multiply a 4×4 column-major matrix by a vec4.
export function mat4MulVec4(m, v) {
  return [
    m[0]*v[0] + m[4]*v[1] + m[8] *v[2] + m[12]*v[3],
    m[1]*v[0] + m[5]*v[1] + m[9] *v[2] + m[13]*v[3],
    m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]*v[3],
    m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15]*v[3],
  ]
}

export function vec3Normalize(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
  return len > 1e-10 ? [v[0]/len, v[1]/len, v[2]/len] : [0, 0, 0]
}

export function vec3Cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ]
}

export function vec3Dot(a, b) {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
}

// Convert spherical coords (azimuth theta around y-axis, elevation phi from equator)
// to Cartesian.
export function sphericalToCartesian(theta, phi, r) {
  return [
    r * Math.cos(phi) * Math.sin(theta),
    r * Math.sin(phi),
    r * Math.cos(phi) * Math.cos(theta),
  ]
}

// Project a 3D model-space point to HTML screen coordinates (y from top) using an MVP
// matrix that maps model space to full-canvas NDC, and the canvas dimensions.
// Returns [htmlX, htmlY] or null if the point is behind the camera (w ≤ 0).
export function projectToScreen(point, mvp, canvasWidth, canvasHeight) {
  const clip = mat4MulVec4(mvp, [point[0], point[1], point[2], 1.0])
  if (clip[3] <= 0) return null
  const ndcX = clip[0] / clip[3]
  const ndcY = clip[1] / clip[3]
  return [
    (ndcX + 1) * 0.5 * canvasWidth,
    (1 - (ndcY + 1) * 0.5) * canvasHeight,
  ]
}
