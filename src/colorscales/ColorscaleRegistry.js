const colorscales = new Map()                   // name → [[t, r, g, b], ...]
const colorscaleNanColors = new Map()           // name → [r, g, b]
const colorscalesUnselected = new Map()         // name → [[t, r, g, b], ...] | null
const colorscaleNanColorsUnselected = new Map() // name → [r, g, b] | null
const colorscales2d = new Map()                 // name → glslFn string
const colorscales2dUnselected = new Map()       // name → glslFn string | null
let colorscalesVersion = 0

export function getColorscalesVersion() { return colorscalesVersion }

export function registerColorscale(name, stops, nanColor = [0.5, 0.5, 0.5], unselectedStops = null, unselectedNanColor = null) {
  colorscales.set(name, stops)
  colorscaleNanColors.set(name, nanColor)
  colorscalesUnselected.set(name, unselectedStops)
  colorscaleNanColorsUnselected.set(name, unselectedNanColor)
  colorscalesVersion++
}

export function register2DColorscale(name, glslFn, unselectedGlslFn = null) {
  colorscales2d.set(name, glslFn)
  colorscales2dUnselected.set(name, unselectedGlslFn)
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

// Build the unified grid of all unique t positions and pre-evaluate every
// colorscale at every grid point.  Returns { width, height, data } suitable
// for passing directly to regl.texture(), or null if no 1D colorscales are
// registered.  width = number of grid points, height = numColorscales * 2.
// Row cs*2 = selected (or only) mapping; row cs*2+1 = unselected mapping.
// If no unselected stops are registered, the unselected row is the selected
// colors dimmed: RGB mixed 60% toward 0.8 gray, alpha = 0.4.
// Explicit unselected rows have alpha = 1.0 (full user control).
export function buildColorscaleTexture() {
  if (colorscales.size === 0) return null

  const tSet = new Set()
  for (const stops of colorscales.values()) {
    for (const [t] of stops) tSet.add(t)
  }
  for (const stops of colorscalesUnselected.values()) {
    if (stops) for (const [t] of stops) tSet.add(t)
  }
  const gridT = Array.from(tSet).sort((a, b) => a - b)
  const N = gridT.length
  const numCs = colorscales.size

  // Extra column at index N stores the NaN color for each colorscale.
  const width = N + 1
  const data = new Float32Array(numCs * 2 * width * 4)

  function fillRow(stops, nanColor, row, dim) {
    for (let gi = 0; gi < N; gi++) {
      const t = gridT[gi]
      let r, g, b
      if (t <= stops[0][0]) {
        ;[, r, g, b] = stops[0]
      } else if (t >= stops[stops.length - 1][0]) {
        ;[, r, g, b] = stops[stops.length - 1]
      } else {
        for (let si = 0; si < stops.length - 1; si++) {
          const [t0, r0, g0, b0] = stops[si]
          const [t1, r1, g1, b1] = stops[si + 1]
          if (t >= t0 && t <= t1) {
            const u = (t - t0) / (t1 - t0)
            r = r0 + u * (r1 - r0)
            g = g0 + u * (g1 - g0)
            b = b0 + u * (b1 - b0)
            break
          }
        }
      }
      const idx = (row * width + gi) * 4
      data[idx + 0] = dim ? r * 0.4 + 0.48 : r
      data[idx + 1] = dim ? g * 0.4 + 0.48 : g
      data[idx + 2] = dim ? b * 0.4 + 0.48 : b
      data[idx + 3] = dim ? 0.4 : 1.0
    }
    const [nr, ng, nb] = nanColor
    const nanIdx = (row * width + N) * 4
    data[nanIdx + 0] = dim ? nr * 0.4 + 0.48 : nr
    data[nanIdx + 1] = dim ? ng * 0.4 + 0.48 : ng
    data[nanIdx + 2] = dim ? nb * 0.4 + 0.48 : nb
    data[nanIdx + 3] = dim ? 0.4 : 1.0
  }

  let csIdx = 0
  for (const [name, stops] of colorscales.entries()) {
    const nanColor = colorscaleNanColors.get(name) ?? [0.5, 0.5, 0.5]
    const unselStops = colorscalesUnselected.get(name) ?? null
    const unselNanColor = colorscaleNanColorsUnselected.get(name) ?? nanColor
    fillRow(stops, nanColor, csIdx * 2, false)
    fillRow(unselStops ?? stops, unselNanColor, csIdx * 2 + 1, unselStops === null)
    csIdx++
  }

  return { width, height: numCs * 2, data }
}

export function buildColorGlsl() {
  if (colorscales.size === 0 && colorscales2d.size === 0) return ''

  const parts = []

  // Safe NaN constant — uintBitsToFloat is a defined bitcast in GLSL ES 3.0 (§8.3).
  // 0x7FC00000 is a standard IEEE 754 quiet NaN.  Using this instead of 0.0/0.0
  // which is undefined behaviour and rejected by ANGLE on D3D11.
  parts.push('const float GLADLY_NAN = uintBitsToFloat(0x7FC00000u);')

  if (colorscales.size > 0) {
    // Build unified t grid from all registered colorscales (selected + unselected)
    const tSet = new Set()
    for (const stops of colorscales.values()) {
      for (const [t] of stops) tSet.add(t)
    }
    for (const stops of colorscalesUnselected.values()) {
      if (stops) for (const [t] of stops) tSet.add(t)
    }
    const gridT = Array.from(tSet).sort((a, b) => a - b)
    const N = gridT.length
    const f = t => t.toFixed(5)

    // Constant array of grid t positions (used for interpolation)
    parts.push(`const float CS_T[${N}] = float[${N}](${gridT.map(f).join(', ')});`)
    // Column N in the colorscale texture stores the NaN color for each colorscale.
    parts.push(`const int CS_NAN_COL = ${N};`)

    // Texture sampler — two rows per colorscale: row cs*2 = selected, cs*2+1 = unselected.
    parts.push('uniform sampler2D u_colorscale_tex;')

    // Ternary chain: maps t ∈ [0,1] to segment index i ∈ [0, N-2]
    // Segment i spans [CS_T[i], CS_T[i+1]].  The chain tests N-2 thresholds.
    const chain = gridT.slice(1, -1).map((t, i) => `t < ${f(t)} ? ${i} :`).join(' ') + ` ${N - 2}`

    // v_selection: -1.0 = no active selection, 1.0 = selected, 0.0 = unselected.
    // Unselected points use row cs*2+1; all others use row cs*2.
    parts.push('vec4 map_color(int cs, vec2 range, float value) {')
    parts.push('  int row = (v_selection >= -0.5 && v_selection < 0.5) ? cs * 2 + 1 : cs * 2;')
    parts.push('  if (value != value) return texelFetch(u_colorscale_tex, ivec2(CS_NAN_COL, row), 0);')
    parts.push('  float t = clamp((value - range.x) / (range.y - range.x), 0.0, 1.0);')
    parts.push(`  int i = ${chain};`)
    parts.push('  vec4 c0 = texelFetch(u_colorscale_tex, ivec2(i,     row), 0);')
    parts.push('  vec4 c1 = texelFetch(u_colorscale_tex, ivec2(i + 1, row), 0);')
    parts.push('  return mix(c0, c1, (t - CS_T[i]) / (CS_T[i + 1] - CS_T[i]));')
    parts.push('}')
  }

  // 2D colorscale functions (fn signature: vec4 colorscale_2d_<name>(vec2 t))
  for (const glslFn of colorscales2d.values()) {
    parts.push(glslFn)
  }
  // Unselected variants (fn signature: vec4 colorscale_2d_<name>_unsel(vec2 t))
  for (const glslFn of colorscales2dUnselected.values()) {
    if (glslFn) parts.push(glslFn)
  }

  // map_color_2d — 2D dispatch, takes normalized vec2 t in [0,1]x[0,1].
  // Dispatches to the unselected variant when v_selection == 0.0; if no unselected
  // variant is registered, applies the default dimming inline.
  parts.push('vec4 map_color_2d(int cs, vec2 t) {')
  parts.push('  bool unsel = (v_selection >= -0.5 && v_selection < 0.5);')
  let idx2d = 0
  for (const name of colorscales2d.keys()) {
    const hasUnsel = !!colorscales2dUnselected.get(name)
    parts.push(`  if (cs == ${idx2d}) {`)
    parts.push(`    if (unsel) {`)
    if (hasUnsel) {
      parts.push(`      return colorscale_2d_${name}_unsel(t);`)
    } else {
      parts.push(`      vec4 c = colorscale_2d_${name}(t);`)
      parts.push(`      c.rgb = mix(c.rgb, vec3(0.8), 0.6);`)
      parts.push(`      c.a *= 0.4;`)
      parts.push(`      return c;`)
    }
    parts.push(`    }`)
    parts.push(`    return colorscale_2d_${name}(t);`)
    parts.push(`  }`)
    idx2d++
  }
  parts.push('  return vec4(0.5, 0.5, 0.5, 1.0);')
  parts.push('}')

  // map_color_s — 1D with scale type and alpha blending.
  // Selection-aware coloring is handled by map_color (texture row selection).
  // useAlpha multiplies the existing alpha so unselected dimming (a=0.4) is preserved.
  parts.push('vec4 map_color_s(int cs, vec2 range, float v, float scaleType, float useAlpha) {')
  parts.push('  bool nan = (v != v);')
  parts.push('  float vt = scaleType > 0.5 ? log(v) : v;')
  parts.push('  float r0 = scaleType > 0.5 ? log(range.x) : range.x;')
  parts.push('  float r1 = scaleType > 0.5 ? log(range.y) : range.y;')
  parts.push('  float t = clamp((vt - r0) / (r1 - r0), 0.0, 1.0);')
  parts.push('  vec4 color = map_color(cs, vec2(r0, r1), vt);')
  parts.push('  if (!nan && useAlpha > 0.5) color.a *= t;')
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
  // useAlpha_a / useAlpha_b: if > 0.5, the normalised value multiplies alpha (preserving
  // any selection dimming already encoded in c.a by map_color / map_color_2d).
  parts.push('vec4 map_color_s_2d(int cs_a, vec2 range_a, float v_a, float type_a, float useAlpha_a,')
  parts.push('                    int cs_b, vec2 range_b, float v_b, float type_b, float useAlpha_b) {')

  parts.push('  bool a_nan = (v_a != v_a);')
  parts.push('  bool b_nan = (v_b != v_b);')
  parts.push('  vec4 c;')

  parts.push('  if (cs_a < 0 && cs_a == cs_b) {')
  parts.push('    float ta = a_nan ? 0.0 : gladly_normalize_color(range_a, v_a, type_a);')
  parts.push('    float tb = b_nan ? 0.0 : gladly_normalize_color(range_b, v_b, type_b);')
  parts.push('    c = map_color_2d(-(cs_a + 1), vec2(ta, tb));')
  parts.push('  } else if (cs_a >= 0) {')
  parts.push('    if (!a_nan)      c = gladly_map_color_raw(cs_a, range_a, v_a, type_a);')
  parts.push('    else if (!b_nan) c = gladly_map_color_raw(cs_b, range_b, v_b, type_b);')
  parts.push('    else             c = vec4(0.0);')
  parts.push('  } else {')
  parts.push('    // fallback (cs_a < 0 but not equal to cs_b)')
  parts.push('    if (!a_nan && !b_nan) {')
  parts.push('      vec4 ca = gladly_map_color_raw(cs_a, range_a, v_a, type_a);')
  parts.push('      vec4 cb = gladly_map_color_raw(cs_b, range_b, v_b, type_b);')
  parts.push('      c = (ca + cb) / 2.0;')
  parts.push('    } else if (!a_nan) c = gladly_map_color_raw(cs_a, range_a, v_a, type_a);')
  parts.push('    else if (!b_nan)   c = gladly_map_color_raw(cs_b, range_b, v_b, type_b);')
  parts.push('    else               c = vec4(0.0);')
  parts.push('  }')

  parts.push('  if (!a_nan && useAlpha_a > 0.5) c.a *= gladly_normalize_color(range_a, v_a, type_a);')
  parts.push('  if (!b_nan && useAlpha_b > 0.5) c.a *= gladly_normalize_color(range_b, v_b, type_b);')

  parts.push('  return gladly_apply_color(c);')
  parts.push('}')

  return parts.join('\n')
}
