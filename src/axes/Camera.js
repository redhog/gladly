import {
  mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt,
  sphericalToCartesian, vec3Normalize, vec3Cross,
} from '../math/mat4.js'

/**
 * Camera manages the MVP matrix for the plot.
 *
 * In 2D mode (is3D=false): getMVP() returns the identity matrix; no mouse interaction.
 * In 3D mode (is3D=true):  orbit camera (y-up) with perspective projection;
 *                           left-drag on the canvas rotates the view.
 */
export class Camera {
  constructor(is3D) {
    this._is3D  = is3D
    this._theta = Math.PI / 4     // azimuth (rotation around y-axis)
    this._phi   = Math.PI / 6     // elevation (angle from equator, clamped away from poles)
    this._radius = 3.0
    this._fov   = Math.PI / 4     // vertical field-of-view (45°)
    this._aspect = 1.0            // width / height, updated by resize()
    this._dragging = false
    this._lastX = 0
    this._lastY = 0
    this._onChange = null
  }

  resize(width, height) {
    this._aspect = width / height
  }

  // Returns the camera MVP matrix as a column-major Float32Array[16].
  // In 2D mode this is the identity (data coordinates already map to NDC via domain uniforms).
  getMVP() {
    if (!this._is3D) return mat4Identity()
    const eye  = sphericalToCartesian(this._theta, this._phi, this._radius)
    const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0])
    const proj = mat4Perspective(this._fov, this._aspect, 0.1, 100)
    return mat4Multiply(proj, view)
  }

  // Returns the camera right and up unit vectors in world space.
  // Used to orient billboard quads so they always face the camera.
  getCameraVectors() {
    if (!this._is3D) return { right: [1, 0, 0], up: [0, 1, 0] }
    const eye = sphericalToCartesian(this._theta, this._phi, this._radius)
    const fwd = vec3Normalize([-eye[0], -eye[1], -eye[2]])
    const right = vec3Normalize(vec3Cross(fwd, [0, 1, 0]))
    const up    = vec3Normalize(vec3Cross(right, fwd))
    return { right, up }
  }

  // Attach left-drag orbit interaction to a canvas element.
  // onChangeFn() is called after each drag event so the plot can schedule a re-render.
  attachMouseEvents(canvas, onChangeFn) {
    if (!this._is3D) return
    this._onChange = onChangeFn

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this._dragging = true
      this._lastX = e.clientX
      this._lastY = e.clientY
    })

    canvas.addEventListener('mousemove', (e) => {
      if (!this._dragging) return
      const dx = e.clientX - this._lastX
      const dy = e.clientY - this._lastY
      this._lastX = e.clientX
      this._lastY = e.clientY
      this._theta -= dx * 0.008
      this._phi = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this._phi + dy * 0.008))
      if (this._onChange) this._onChange()
    })

    const stopDrag = () => { this._dragging = false }
    canvas.addEventListener('mouseup',    stopDrag)
    canvas.addEventListener('mouseleave', stopDrag)
  }
}
