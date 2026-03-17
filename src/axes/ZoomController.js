import { AXIS_GEOMETRY, axisEndpoints } from './AxisRegistry.js'
import { mat4Multiply, mat4Identity, projectToScreen, sphericalToCartesian } from '../math/mat4.js'

export class ZoomController {
  constructor(plot) {
    this._plot = plot
    this._init()
  }

  // Recompute the axis MVP — same matrix Plot.render() uses for axis lines/labels.
  _computeAxisMvp() {
    const { width, height, plotWidth, plotHeight, margin, _camera } = this._plot
    const sx = plotWidth  / width
    const sy = plotHeight / height
    const cx = (margin.left   - margin.right)  / width
    const cy = (margin.bottom - margin.top)    / height
    const Mvp = new Float32Array([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0,  0, 1, 0,
      cx, cy, 0, 1,
    ])
    return mat4Multiply(Mvp, _camera ? _camera.getMVP() : mat4Identity())
  }

  // Return { axes: [axisId, ...], type: 'plot_area'|'axis' } or null.
  _getRegion(mx, my) {
    return this._plot._is3D ? this._getRegion3D(mx, my) : this._getRegion2D(mx, my)
  }

  _getRegion2D(mx, my) {
    const { margin, plotWidth, plotHeight, axisRegistry: ar } = this._plot
    const inX = mx >= margin.left && mx < margin.left + plotWidth
    const inY = my >= margin.top  && my < margin.top  + plotHeight

    if (inX && inY)
      return { axes: ['xaxis_bottom','xaxis_top','yaxis_left','yaxis_right'].filter(a => ar.getScale(a)), type: 'plot_area' }
    if (inX && my < margin.top              && ar.getScale('xaxis_top'))    return { axes: ['xaxis_top'],    type: 'axis' }
    if (inX && my >= margin.top + plotHeight && ar.getScale('xaxis_bottom')) return { axes: ['xaxis_bottom'], type: 'axis' }
    if (inY && mx < margin.left              && ar.getScale('yaxis_left'))   return { axes: ['yaxis_left'],   type: 'axis' }
    if (inY && mx >= margin.left + plotWidth && ar.getScale('yaxis_right'))  return { axes: ['yaxis_right'],  type: 'axis' }
    return null
  }

  _getRegion3D(mx, my) {
    const plot = this._plot
    const { width, height, axisRegistry: ar, _camera: cam } = plot
    const axisMvp = this._computeAxisMvp()

    // Camera eye for front-face culling
    const eye = sphericalToCartesian(cam._theta, cam._phi, cam._radius)
    const eyeLen = Math.sqrt(eye[0]**2 + eye[1]**2 + eye[2]**2)

    let bestAxis = null
    let bestDist = Infinity

    for (const axisId of Object.keys(AXIS_GEOMETRY)) {
      if (!ar.getScale(axisId)) continue

      const { outward } = AXIS_GEOMETRY[axisId]

      // Skip back-facing axes: outward normal points away from camera
      const facingCam = outward[0]*eye[0]/eyeLen + outward[1]*eye[1]/eyeLen + outward[2]*eye[2]/eyeLen
      if (facingCam <= 0) continue

      const { start, end } = axisEndpoints(axisId)
      const startS = projectToScreen(start, axisMvp, width, height)
      const endS   = projectToScreen(end,   axisMvp, width, height)
      if (!startS || !endS) continue

      // Project outward direction to screen space via the axis midpoint
      const mid  = [(start[0]+end[0])/2, (start[1]+end[1])/2, (start[2]+end[2])/2]
      const midO = [mid[0]+outward[0]*0.2, mid[1]+outward[1]*0.2, mid[2]+outward[2]*0.2]
      const midS  = projectToScreen(mid,  axisMvp, width, height)
      const midOS = projectToScreen(midO, axisMvp, width, height)
      if (!midS || !midOS) continue

      // Perpendicular to projected axis segment, aligned with screen-space outward direction
      const segDx = endS[0] - startS[0]
      const segDy = endS[1] - startS[1]
      const segLen = Math.sqrt(segDx**2 + segDy**2)
      if (segLen < 1e-6) continue

      let perpX = -segDy / segLen
      let perpY =  segDx / segLen
      const odx = midOS[0] - midS[0]
      const ody = midOS[1] - midS[1]
      if (perpX*odx + perpY*ody < 0) { perpX = -perpX; perpY = -perpY }

      // Signed distance from click to axis line (positive = outward / margin side)
      const signedDist = (mx - startS[0]) * perpX + (my - startS[1]) * perpY
      if (signedDist <= 0) continue

      // Projection along segment — reject clicks far off the ends
      const segT = ((mx-startS[0])*segDx + (my-startS[1])*segDy) / segLen**2
      if (segT < -0.5 || segT > 1.5) continue

      if (signedDist < bestDist) {
        bestDist = signedDist
        bestAxis = axisId
      }
    }

    if (bestAxis) return { axes: [bestAxis], type: 'axis' }

    // Inside plot: all active spatial axes
    return { axes: Object.keys(AXIS_GEOMETRY).filter(a => ar.getScale(a)), type: 'plot_area' }
  }

  // Unproject a canvas pixel to a point in normalised [-1,+1]³ world space.
  //
  // 2D: direct pixel → NDC (identity camera MVP).
  // 3D: find the intersection of the camera ray through the pixel with the
  //     screen plane that passes through the world origin (the orbit target).
  //     In eye space the origin sits at z_eye = -radius, so the ray parameter
  //     at that depth is exactly radius, giving:
  //       P_eye = [nx * aspect * radius / f,  ny * radius / f,  -radius]
  //     Converting back to world space via the camera right/up vectors yields
  //     P_world = right * P_eye.x + up * P_eye.y  (the z component cancels).
  _unproject(mx, my) {
    const { margin, plotWidth, plotHeight, _is3D, _camera } = this._plot

    const nx = (mx - margin.left) * 2 / plotWidth  - 1
    const ny = 1 - (my - margin.top) * 2 / plotHeight

    if (!_is3D) return [nx, ny, 0]

    const { right, up } = _camera.getCameraVectors()
    const f      = 1 / Math.tan(_camera._fov / 2)
    const radius = _camera._radius
    const aspect = plotWidth / plotHeight
    const sx = nx * aspect * radius / f
    const sy = ny          * radius / f
    return [
      right[0]*sx + up[0]*sy,
      right[1]*sx + up[1]*sy,
      right[2]*sx + up[2]*sy,
    ]
  }

  _init() {
    const plot   = this._plot
    const canvas = plot.canvas

    canvas.addEventListener('contextmenu', e => e.preventDefault())

    let isDragging   = false
    let isRotating   = false
    let dragRegion   = null
    let startWorld   = null  // world point [x,y,z] pinned at drag start
    let startDomains = {}    // { axisId: [d0,d1] } snapshot at drag start
    let lastMouse    = null  // [x,y] for rotation delta
    let dragRect     = null  // cached at mousedown; canvas position doesn't change during a drag
    const onMouseMove = (e) => {
      const _t0 = performance.now()
      const mx = e.clientX - dragRect.left
      const my = e.clientY - dragRect.top

      if (isRotating) {
        const [lx, ly] = lastMouse
        const dx = mx - lx
        const dy = my - ly
        plot._camera._theta -= dx * 0.008
        plot._camera._phi = Math.max(
          -Math.PI / 2 + 0.02,
          Math.min(Math.PI / 2 - 0.02, plot._camera._phi + dy * 0.008)
        )
        lastMouse = [mx, my]
        plot.scheduleRender()
        const _dt = performance.now() - _t0
        if (_dt > 2) console.warn(`[gladly] onMouseMove(rotate) ${_dt.toFixed(1)}ms`)
        return
      }

      if (!isDragging) return

      const currentWorld = this._unproject(mx, my)
      const dw = [
        startWorld[0] - currentWorld[0],
        startWorld[1] - currentWorld[1],
        startWorld[2] - currentWorld[2],
      ]

      for (const axisId of dragRegion.axes) {
        const startDomain = startDomains[axisId]
        if (!startDomain) continue
        if (!plot.axisRegistry.getScale(axisId)) continue

        const { dir } = AXIS_GEOMETRY[axisId]
        const dirIdx  = dir === 'x' ? 0 : dir === 'y' ? 1 : 2
        const isLog   = plot.axisRegistry.isLogScale(axisId)
        const t0      = isLog ? Math.log(startDomain[0]) : startDomain[0]
        const t1      = isLog ? Math.log(startDomain[1]) : startDomain[1]
        // Normalised world space: delta_normalised = delta_t * 2 / (t1-t0)
        // → delta_t = dw[dirIdx] * (t1-t0) / 2
        const deltaT  = dw[dirIdx] * (t1 - t0) / 2
        const newT0   = t0 + deltaT
        const newT1   = t1 + deltaT
        plot._getAxis(axisId).setDomain(isLog ? [Math.exp(newT0), Math.exp(newT1)] : [newT0, newT1])
      }

      plot.scheduleRender()
      const _dt = performance.now() - _t0
      if (_dt > 2) console.warn(`[gladly] onMouseMove(pan) ${_dt.toFixed(1)}ms`)
    }

    const onMouseUp = (e) => {
      if (isDragging || isRotating) plot._zoomEndCallbacks.forEach(cb => cb())
      isDragging   = false
      isRotating   = false
      dragRegion   = null
      startWorld   = null
      startDomains = {}
      lastMouse    = null
      dragRect     = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault()
      dragRect = canvas.getBoundingClientRect()
      const mx = e.clientX - dragRect.left
      const my = e.clientY - dragRect.top

      // Right-click or Ctrl+left in 3D → rotate
      if (plot._is3D && (e.button === 2 || (e.button === 0 && e.ctrlKey))) {
        isRotating = true
        lastMouse  = [mx, my]
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup',   onMouseUp)
        return
      }

      if (e.button !== 0) return

      // Left-click → pan
      const region = this._getRegion(mx, my)
      if (!region) return

      isDragging   = true
      dragRegion   = region
      startWorld   = this._unproject(mx, my)
      startDomains = {}
      for (const axisId of region.axes) {
        const scale = plot.axisRegistry.getScale(axisId)
        if (scale) startDomains[axisId] = scale.domain().slice()
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup',   onMouseUp)
    })

    // Touch support
    let touchDragging   = false
    let touchZooming    = false
    let touchDragRegion = null
    let touchStartWorld = null
    let touchStartDomains = {}
    let touchLastDist   = null
    let touchZoomRegion = null
    let touchRect       = null

    const getTouchMid = (touches) => [
      (touches[0].clientX + touches[1].clientX) / 2,
      (touches[0].clientY + touches[1].clientY) / 2,
    ]
    const getTouchDist = (touches) => {
      const dx = touches[1].clientX - touches[0].clientX
      const dy = touches[1].clientY - touches[0].clientY
      return Math.sqrt(dx*dx + dy*dy)
    }

    const startTouchPan = (mx, my) => {
      const region = this._getRegion(mx, my)
      if (!region) return
      touchDragging   = true
      touchDragRegion = region
      touchStartWorld = this._unproject(mx, my)
      touchStartDomains = {}
      for (const axisId of region.axes) {
        const scale = plot.axisRegistry.getScale(axisId)
        if (scale) touchStartDomains[axisId] = scale.domain().slice()
      }
    }

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()
      touchRect = canvas.getBoundingClientRect()

      if (e.touches.length === 1) {
        touchZooming = false
        touchZoomRegion = null
        touchLastDist = null
        const t = e.touches[0]
        startTouchPan(t.clientX - touchRect.left, t.clientY - touchRect.top)
      } else if (e.touches.length === 2) {
        touchDragging = false
        touchZooming  = true
        touchLastDist = getTouchDist(e.touches)
        const [midX, midY] = getTouchMid(e.touches)
        const mx = midX - touchRect.left
        const my = midY - touchRect.top
        touchZoomRegion = this._getRegion(mx, my)
      }
    }, { passive: false })

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      if (!touchRect) return

      if (touchDragging && e.touches.length === 1) {
        const t = e.touches[0]
        const mx = t.clientX - touchRect.left
        const my = t.clientY - touchRect.top
        const currentWorld = this._unproject(mx, my)
        const dw = [
          touchStartWorld[0] - currentWorld[0],
          touchStartWorld[1] - currentWorld[1],
          touchStartWorld[2] - currentWorld[2],
        ]
        for (const axisId of touchDragRegion.axes) {
          const startDomain = touchStartDomains[axisId]
          if (!startDomain) continue
          if (!plot.axisRegistry.getScale(axisId)) continue
          const { dir } = AXIS_GEOMETRY[axisId]
          const dirIdx  = dir === 'x' ? 0 : dir === 'y' ? 1 : 2
          const isLog   = plot.axisRegistry.isLogScale(axisId)
          const t0      = isLog ? Math.log(startDomain[0]) : startDomain[0]
          const t1      = isLog ? Math.log(startDomain[1]) : startDomain[1]
          const deltaT  = dw[dirIdx] * (t1 - t0) / 2
          plot._getAxis(axisId).setDomain(isLog
            ? [Math.exp(t0 + deltaT), Math.exp(t1 + deltaT)]
            : [t0 + deltaT, t1 + deltaT])
        }
        plot.scheduleRender()
      } else if (touchZooming && e.touches.length === 2) {
        const newDist = getTouchDist(e.touches)
        const factor  = touchLastDist / newDist   // pinch out → zoom in (factor < 1)
        touchLastDist = newDist
        if (!touchZoomRegion) return
        const [midX, midY] = getTouchMid(e.touches)
        const mx = midX - touchRect.left
        const my = midY - touchRect.top
        const worldCursor = this._unproject(mx, my)
        for (const axisId of touchZoomRegion.axes) {
          const scale = plot.axisRegistry.getScale(axisId)
          if (!scale) continue
          const { dir } = AXIS_GEOMETRY[axisId]
          const dirIdx   = dir === 'x' ? 0 : dir === 'y' ? 1 : 2
          const [d0, d1] = scale.domain()
          const isLog    = plot.axisRegistry.isLogScale(axisId)
          const t0       = isLog ? Math.log(d0) : d0
          const t1       = isLog ? Math.log(d1) : d1
          const tCursor  = (worldCursor[dirIdx] + 1) / 2 * (t1 - t0) + t0
          const newT0    = tCursor + (t0 - tCursor) * factor
          const newT1    = tCursor + (t1 - tCursor) * factor
          plot._getAxis(axisId).setDomain(isLog ? [Math.exp(newT0), Math.exp(newT1)] : [newT0, newT1])
        }
        plot.scheduleRender()
        plot._zoomEndCallbacks.forEach(cb => cb())
      }
    }, { passive: false })

    const onTouchEnd = (e) => {
      e.preventDefault()
      if (touchDragging || touchZooming) plot._zoomEndCallbacks.forEach(cb => cb())
      touchDragging   = false
      touchZooming    = false
      touchDragRegion = null
      touchStartWorld = null
      touchStartDomains = {}
      touchLastDist   = null
      touchZoomRegion = null
      // If one finger remains after a pinch, restart pan from current position
      if (e.touches.length === 1 && touchRect) {
        const t = e.touches[0]
        startTouchPan(t.clientX - touchRect.left, t.clientY - touchRect.top)
      } else {
        touchRect = null
      }
    }
    canvas.addEventListener('touchend',    onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false })

    // Scroll wheel: zoom toward cursor position
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (!plot.axisRegistry) return

      const rect   = canvas.getBoundingClientRect()
      const mx     = e.clientX - rect.left
      const my     = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const region = this._getRegion(mx, my)
      if (!region) return

      const worldCursor = this._unproject(mx, my)

      for (const axisId of region.axes) {
        const scale = plot.axisRegistry.getScale(axisId)
        if (!scale) continue

        const { dir } = AXIS_GEOMETRY[axisId]
        const dirIdx   = dir === 'x' ? 0 : dir === 'y' ? 1 : 2
        const [d0, d1] = scale.domain()
        const isLog    = plot.axisRegistry.isLogScale(axisId)
        const t0       = isLog ? Math.log(d0) : d0
        const t1       = isLog ? Math.log(d1) : d1
        // Cursor t-position: worldCursor[dirIdx] ∈ [-1,+1] → t-space
        const tCursor  = (worldCursor[dirIdx] + 1) / 2 * (t1 - t0) + t0
        // Zoom around cursor: keep tCursor fixed, scale the domain
        const newT0    = tCursor + (t0 - tCursor) * factor
        const newT1    = tCursor + (t1 - tCursor) * factor
        plot._getAxis(axisId).setDomain(isLog ? [Math.exp(newT0), Math.exp(newT1)] : [newT0, newT1])
      }

      plot.scheduleRender()
      plot._zoomEndCallbacks.forEach(cb => cb())
    }, { passive: false })
  }
}
