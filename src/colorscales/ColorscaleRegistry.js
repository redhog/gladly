const colorscales = new Map()
const colorscales2d = new Map()

export function registerColorscale(name, glslFn) {
  colorscales.set(name, glslFn)
}

export function register2DColorscale(name, glslFn) {
  colorscales2d.set(name, glslFn)
}

export function getRegisteredColorscales() {
  return colorscales
}

export function getRegistered2DColorscales() {
  return colorscales2d
}

export function getColorscaleIndex(name) {
  let idx = 0
  for (const key of colorscales.keys()) {
    if (key === name) return idx
    idx++
  }
  // 2D colorscales use negative indices: -(idx + 1)
  let idx2d = 0
  for (const key of colorscales2d.keys()) {
    if (key === name) return -(idx2d + 1)
    idx2d++
  }
  return 0
}

export function get2DColorscaleIndex(name) {
  let idx = 0
  for (const key of colorscales2d.keys()) {
    if (key === name) return -(idx + 1)
    idx++
  }
  return null
}

export function buildColorGlsl() {
  if (colorscales.size === 0 && colorscales2d.size === 0) return ''

  const parts = []

  // 1D colorscale functions
  for (const glslFn of colorscales.values()) {
    parts.push(glslFn)
  }

  // 2D colorscale functions (fn signature: vec4 colorscale_2d_<name>(vec2 t))
  for (const glslFn of colorscales2d.values()) {
    parts.push(glslFn)
  }

  // map_color — 1D dispatch, operates in already-transformed (possibly log) space
  parts.push('vec4 map_color(int cs, vec2 range, float value) {')
  parts.push('  float t = clamp((value - range.x) / (range.y - range.x), 0.0, 1.0);')
  let idx = 0
  for (const name of colorscales.keys()) {
    parts.push(`  if (cs == ${idx}) return colorscale_${name}(t);`)
    idx++
  }
  parts.push('  return vec4(0.5, 0.5, 0.5, 1.0);')
  parts.push('}')

  // map_color_2d — 2D dispatch, takes normalized vec2 t in [0,1]x[0,1]
  parts.push('vec4 map_color_2d(int cs, vec2 t) {')
  let idx2d = 0
  for (const name of colorscales2d.keys()) {
    parts.push(`  if (cs == ${idx2d}) return colorscale_2d_${name}(t);`)
    idx2d++
  }
  parts.push('  return vec4(0.5, 0.5, 0.5, 1.0);')
  parts.push('}')

  // map_color_s — 1D with scale type, alpha blending, and picking
  parts.push('vec4 map_color_s(int cs, vec2 range, float v, float scaleType, float useAlpha) {')
  parts.push('  float vt = scaleType > 0.5 ? log(v) : v;')
  parts.push('  float r0 = scaleType > 0.5 ? log(range.x) : range.x;')
  parts.push('  float r1 = scaleType > 0.5 ? log(range.y) : range.y;')
  parts.push('  float t = clamp((vt - r0) / (r1 - r0), 0.0, 1.0);')
  parts.push('  vec4 color = map_color(cs, vec2(r0, r1), vt);')
  parts.push('  if (useAlpha > 0.5) color.a = t;')
  parts.push('  return gladly_apply_color(color);')
  parts.push('}')

  // gladly_map_color_raw — like map_color_s but without picking/apply, used internally by map_color_s_2d
  parts.push('vec4 gladly_map_color_raw(int cs, vec2 range, float v, float scaleType) {')
  parts.push('  float vt = scaleType > 0.5 ? log(v) : v;')
  parts.push('  float r0 = scaleType > 0.5 ? log(range.x) : range.x;')
  parts.push('  float r1 = scaleType > 0.5 ? log(range.y) : range.y;')
  parts.push('  return map_color(cs, vec2(r0, r1), vt);')
  parts.push('}')

  // gladly_normalize_color — normalize a data value to [0,1] for 2D colorscale lookup
  parts.push('float gladly_normalize_color(vec2 range, float v, float scaleType) {')
  parts.push('  float vt = scaleType > 0.5 ? log(v) : v;')
  parts.push('  float r0 = scaleType > 0.5 ? log(range.x) : range.x;')
  parts.push('  float r1 = scaleType > 0.5 ? log(range.y) : range.y;')
  parts.push('  return clamp((vt - r0) / (r1 - r0), 0.0, 1.0);')
  parts.push('}')

  // map_color_s_2d — blend two 1D colorscales, or dispatch to a true 2D colorscale.
  // A true 2D colorscale is selected when cs_a < 0 && cs_a == cs_b (both axes share the
  // same 2D colorscale, identified by the negative index -(idx+1)).
  parts.push('vec4 map_color_s_2d(int cs_a, vec2 range_a, float v_a, float type_a,')
  parts.push('                    int cs_b, vec2 range_b, float v_b, float type_b) {')
  parts.push('  if (cs_a < 0 && cs_a == cs_b) {')
  parts.push('    float ta = gladly_normalize_color(range_a, v_a, type_a);')
  parts.push('    float tb = gladly_normalize_color(range_b, v_b, type_b);')
  parts.push('    return gladly_apply_color(map_color_2d(-(cs_a + 1), vec2(ta, tb)));')
  parts.push('  }')
  parts.push('  return gladly_apply_color(')
  parts.push('    (gladly_map_color_raw(cs_a, range_a, v_a, type_a) +')
  parts.push('     gladly_map_color_raw(cs_b, range_b, v_b, type_b)) / 2.0')
  parts.push('  );')
  parts.push('}')

  return parts.join('\n')
}
