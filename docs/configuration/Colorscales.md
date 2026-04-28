# Colorscales

All [matplotlib colorscales](https://matplotlib.org/stable/gallery/color/colormap_reference.html) are registered by default on import.

Use `registerColorscale(name, stops, nanColor?)` to add custom 1D colorscales. `stops` is an array of `[t, r, g, b]` entries where `t ∈ [0, 1]` and `r, g, b ∈ [0, 1]`. For 2D colorscales use `register2DColorscale(name, glslFn)` where `glslFn` is a GLSL function `vec4 colorscale_2d_NAME(vec2 t)`. See [Extension API](../extension-api/LayerTypes.md#registercolorscalename-stops-nancolor) for details.

---

## Perceptually uniform sequential

`viridis`, `plasma`, `inferno`, `magma`, `cividis`

---

## Sequential (single-hue)

`Blues`, `Greens`, `Reds`, `Oranges`, `Purples`, `Greys`

---

## Sequential (multi-hue)

`YlOrBr`, `YlOrRd`, `OrRd`, `PuRd`, `RdPu`, `BuPu`, `GnBu`, `PuBu`, `YlGnBu`, `PuBuGn`, `BuGn`, `YlGn`

---

## Diverging

`PiYG`, `PRGn`, `BrBG`, `PuOr`, `RdGy`, `RdBu`, `RdYlBu`, `RdYlGn`, `Spectral`, `coolwarm`, `bwr`, `seismic`

---

## Cyclic

`twilight`, `twilight_shifted`, `hsv`

---

## Sequential (misc)

`hot`, `afmhot`, `gist_heat`, `copper`, `bone`, `pink`, `spring`, `summer`, `autumn`, `winter`, `cool`, `Wistia`, `gray`

---

## Miscellaneous

`jet`, `turbo`, `rainbow`, `gnuplot`, `gnuplot2`, `CMRmap`, `cubehelix`, `nipy_spectral`, `gist_rainbow`, `gist_earth`, `terrain`, `ocean`, `brg`

---

## 2D (Bivariate)

2D colorscales map a 2D position to a color. Use with layers that support two color axes or with `config.colorbars` by specifying both `xAxis` and `yAxis`.

`bilinear4corner`, `Gred`, `Reen`, `hsv_phase_magnitude`, `diverging_diverging`, `lightness_hue`, `brewer_3x3`, `moreland_5x5`, `boys_surface`, `diverging_sequential`
