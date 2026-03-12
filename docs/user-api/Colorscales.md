# Colorscales

All [matplotlib colorscales](https://matplotlib.org/stable/gallery/color/colormap_reference.html) are registered by default on import.

Use `registerColorscale(name, glslFn)` to add custom colorscales.

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
