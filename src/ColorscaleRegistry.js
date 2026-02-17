const colorscales = new Map()

export function registerColorscale(name, glslFn) {
  colorscales.set(name, glslFn)
}

export function getRegisteredColorscales() {
  return colorscales
}

export function getColorscaleIndex(name) {
  let idx = 0
  for (const key of colorscales.keys()) {
    if (key === name) return idx
    idx++
  }
  return 0
}

export function buildColorGlsl() {
  if (colorscales.size === 0) return ''

  const parts = []

  for (const glslFn of colorscales.values()) {
    parts.push(glslFn)
  }

  parts.push('vec4 map_color(int cs, vec2 range, float value) {')
  parts.push('  float t = clamp((value - range.x) / (range.y - range.x), 0.0, 1.0);')

  let idx = 0
  for (const name of colorscales.keys()) {
    parts.push(`  if (cs == ${idx}) return colorscale_${name}(t);`)
    idx++
  }

  parts.push('  return vec4(0.5, 0.5, 0.5, 1.0);')
  parts.push('}')

  return parts.join('\n')
}
