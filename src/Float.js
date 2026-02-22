const DRAG_BAR_HEIGHT = 12
const MIN_WIDTH  = 80
const MIN_HEIGHT = DRAG_BAR_HEIGHT + 30

// Generic draggable, resizable floating container that wraps any Plot-like widget.
// factory(container) must return an object with a destroy() method.
export class Float {
  constructor(parentPlot, factory, {
    x = 10,
    y = 10,
    width = 220,
    height = 82
  } = {}) {
    // Outer floating container
    this._el = document.createElement('div')
    Object.assign(this._el.style, {
      position:     'absolute',
      left:         x + 'px',
      top:          y + 'px',
      width:        width + 'px',
      height:       height + 'px',
      zIndex:       '10',
      boxSizing:    'border-box',
      background:   'rgba(255,255,255,0.88)',
      border:       '1px solid #aaa',
      borderRadius: '4px',
      boxShadow:    '0 2px 8px rgba(0,0,0,0.25)',
      overflow:     'hidden'
    })

    // Ensure parent is positioned so our absolute child is contained within it
    const parentEl = parentPlot.container
    if (getComputedStyle(parentEl).position === 'static') {
      parentEl.style.position = 'relative'
    }
    parentEl.appendChild(this._el)

    // Drag bar — thin strip at the top; dragging here moves the float
    this._dragBar = document.createElement('div')
    Object.assign(this._dragBar.style, {
      position:     'absolute',
      top:          '0',
      left:         '0',
      right:        '0',
      height:       DRAG_BAR_HEIGHT + 'px',
      cursor:       'grab',
      background:   'rgba(0,0,0,0.07)',
      borderBottom: '1px solid rgba(0,0,0,0.12)',
      zIndex:       '1'
    })
    this._el.appendChild(this._dragBar)

    // Resize handle — bottom-right corner
    this._resizeHandle = document.createElement('div')
    Object.assign(this._resizeHandle.style, {
      position:            'absolute',
      right:               '0',
      bottom:              '0',
      width:               '12px',
      height:              '12px',
      cursor:              'se-resize',
      background:          'rgba(0,0,0,0.18)',
      borderTopLeftRadius: '3px',
      zIndex:              '3'
    })
    this._el.appendChild(this._resizeHandle)

    // Content area — sits below the drag bar, fills the rest of the float
    this._contentEl = document.createElement('div')
    Object.assign(this._contentEl.style, {
      position: 'absolute',
      top:      DRAG_BAR_HEIGHT + 'px',
      left:     '0',
      right:    '0',
      bottom:   '0'
    })
    this._el.appendChild(this._contentEl)

    this._widget = factory(this._contentEl)

    this._setupInteraction()
  }

  _setupInteraction() {
    let mode = null  // 'drag' | 'resize'
    let startX, startY, startLeft, startTop, startW, startH

    const onDragBarMouseDown = (e) => {
      mode      = 'drag'
      startX    = e.clientX
      startY    = e.clientY
      startLeft = parseInt(this._el.style.left, 10)
      startTop  = parseInt(this._el.style.top,  10)
      this._dragBar.style.cursor = 'grabbing'
      e.preventDefault()
    }

    const onResizeMouseDown = (e) => {
      mode   = 'resize'
      startX = e.clientX
      startY = e.clientY
      startW = this._el.offsetWidth
      startH = this._el.offsetHeight
      e.preventDefault()
      e.stopPropagation()
    }

    const onMouseMove = (e) => {
      if (!mode) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (mode === 'drag') {
        this._el.style.left = (startLeft + dx) + 'px'
        this._el.style.top  = (startTop  + dy) + 'px'
      } else {
        this._el.style.width  = Math.max(MIN_WIDTH,  startW + dx) + 'px'
        this._el.style.height = Math.max(MIN_HEIGHT, startH + dy) + 'px'
      }
    }

    const onMouseUp = () => {
      if (mode === 'drag') this._dragBar.style.cursor = 'grab'
      mode = null
    }

    this._dragBar.addEventListener('mousedown', onDragBarMouseDown)
    this._resizeHandle.addEventListener('mousedown', onResizeMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)

    this._cleanupInteraction = () => {
      this._dragBar.removeEventListener('mousedown', onDragBarMouseDown)
      this._resizeHandle.removeEventListener('mousedown', onResizeMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup',   onMouseUp)
    }
  }

  destroy() {
    this._cleanupInteraction()
    this._widget.destroy()
    this._el.remove()
  }
}
