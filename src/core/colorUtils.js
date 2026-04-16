export function parseCssColor(hex) {
  const s = hex.replace(/^#/, '')
  let r, g, b, a
  if (s.length === 3 || s.length === 4) {
    r = parseInt(s[0] + s[0], 16)
    g = parseInt(s[1] + s[1], 16)
    b = parseInt(s[2] + s[2], 16)
    a = s.length === 4 ? parseInt(s[3] + s[3], 16) : 255
  } else if (s.length === 6 || s.length === 8) {
    r = parseInt(s.slice(0, 2), 16)
    g = parseInt(s.slice(2, 4), 16)
    b = parseInt(s.slice(4, 6), 16)
    a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255
  } else {
    throw new Error(`Invalid CSS hex color: ${hex}`)
  }
  return [r / 255, g / 255, b / 255, a / 255]
}
