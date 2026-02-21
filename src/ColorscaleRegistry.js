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

  parts.push('vec4 map_color_s(int cs, vec2 range, float v, float scaleType, float useAlpha) {')
  parts.push('  float vt = scaleType > 0.5 ? log(v) : v;')
  parts.push('  float r0 = scaleType > 0.5 ? log(range.x) : range.x;')
  parts.push('  float r1 = scaleType > 0.5 ? log(range.y) : range.y;')
  parts.push('  float t = clamp((vt - r0) / (r1 - r0), 0.0, 1.0);')
  parts.push('  vec4 color = map_color(cs, vec2(r0, r1), vt);')
  parts.push('  if (useAlpha > 0.5) color.a = t;')
  parts.push('  return gladly_apply_color(color);')
  parts.push('}')

  return parts.join('\n')
}
