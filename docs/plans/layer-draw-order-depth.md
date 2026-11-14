# Plan: Layer Draw Order via Per-Layer Depth Bias

## Overview

The `layers-draw-in-order` branch makes 2D layers stack in config order (later layer on
top). It does this by **disabling the depth test when the plot is 2D** (`depthEnable:
this._is3D`). This plan replaces that mechanism.

The plot-level gate is the wrong axis to split on. A flat ("2D") layer — points, lines,
bars, anything with no `zAxis` — can be placed in a **3D** plot, where it is drawn on the
`zDomain.x` plane. Flat layers default `zDomain = [0,1]`, so they all land on `nz = 0` and
are **coplanar**. In a 3D plot the current code turns the depth test on, so multiple
coplanar flat layers z-fight and lose their config-order stacking — the predicted failure.

The fix: keep the depth test **always enabled** (one uniform code path) and give each flat
layer a tiny per-layer nudge along NDC-z proportional to its draw-order index. Later layers
nudge slightly toward the camera, so with depth func `less` they draw on top — in both 2D
and 3D. Genuine 3D layers (`zAxis != null`) get no bias and keep true depth occlusion.

A per-draw `gl.polygonOffset` is **not** used: it only affects triangle primitives, so it
would do nothing for point and line layers. The bias is applied in the vertex shader, which
covers every primitive type.

`DEPTH_BIAS_STEP = 1e-4` (NDC-z per draw-order index). This is well above 24-bit depth
quantization (~6e-8), fits thousands of layers in the depth range, and in 3D only lets a
flat layer win against real geometry sitting within 1e-4 NDC of its plane — negligible
chance of reordering true 3D content.

The unrelated half of the branch (skip a layer whose quantity kind clashes with an earlier
layer on the same axis slot) is **not** touched by this plan.

---

## Part 1: Shader — apply the bias

### `src/axes/AxisRegistry.js` — `buildSpatialGlsl()`

- Add a uniform declaration: `uniform float u_depthBias;`.
- In `plot_pos_3d`, capture the clip position in a local and bias it before returning:

  ```glsl
  vec4 p = u_mvp * vec4(nx*2.0-1.0, ny*2.0-1.0, nz*2.0-1.0, 1.0);
  p.z -= u_depthBias * p.w;
  return p;
  ```

- In the 2D branch of `plot_pos` (the `u_is3D <= 0.5` path), do the same:

  ```glsl
  v_clip_pos = vec3(nx, ny, 0.5);
  vec4 p = u_mvp * vec4(nx*2.0-1.0, ny*2.0-1.0, 0.0, 1.0);
  p.z -= u_depthBias * p.w;
  return p;
  ```

Multiplying by `p.w` makes `p.z -= u_depthBias * p.w` a constant shift in NDC-z after the
perspective divide. `v_clip_pos` (used by the 3D clip-discard) is assigned before the bias,
so clipping behaviour is unchanged. The `plot_pos` 3D branch delegates to `plot_pos_3d`, so
the bias is applied exactly once there.

---

## Part 2: Draw command — always depth-test, wire the uniform

### `src/core/LayerType.js` — `createDrawCommand`

- **Remove** the line added by the branch:

  ```js
  depth: { enable: regl.prop("depthEnable") },
  ```

  With no `depth` key, regl's default applies (depth test enabled, func `less`, mask true),
  which matches master's always-on behaviour. The pick/capture command keeps its own
  explicit `depth: { enable: false }` — untouched.

- Add `u_depthBias` to the uniforms map (next to the other spatial props):

  ```js
  u_depthBias: regl.prop("u_depthBias"),
  ```

  No `removeUniformDecl(vertSrc, 'u_depthBias')` is needed: no layer's own vertex source
  declares `u_depthBias`, so there is no duplicate declaration to strip (unlike `xDomain`,
  `u_mvp`, etc., which the layer sources do declare).

---

## Part 3: Plot — compute the per-layer bias

### `src/core/Plot.js`

- Define the constant near the other module-level constants:

  ```js
  const DEPTH_BIAS_STEP = 1e-4
  ```

- In `_buildLayerProps(layer, layerIdx, …)`:
  - **Remove** `depthEnable: this._is3D`.
  - **Add**:

    ```js
    u_depthBias: layer.zAxis == null ? layerIdx * DEPTH_BIAS_STEP : 0,
    ```

  `layerIdx` is already the draw-order index (the loop index in `render()`, also passed as
  `u_pickLayerIndex`). Only flat layers (`zAxis == null`) receive the bias; genuine 3D
  layers get `0`. In a 2D plot every layer is flat, so this reduces to exactly "z =
  draw-order index" for every layer.

---

## Behavioural result

| Scenario | Before (branch) | After (this plan) |
|---|---|---|
| 2D plot, N layers | depth test off; painter's order | depth test on; draw-order depth bias stacks later on top |
| 3D plot, flat layers only | depth test on; coplanar layers z-fight | each flat layer biased by draw index → config-order stacking |
| 3D plot, true 3D layers | real depth occlusion | unchanged (`u_depthBias = 0`) |
| 3D plot, mix of flat + 3D | flat layers z-fight among themselves | flat layers stack by draw order; 3D layers keep true occlusion |

Depth is never disabled, so there is a single rendering path for 2D and 3D.

---

## Tests — `test/plot-layers.test.js`

Extend the existing file:

- A flat multi-layer plot: assert `u_depthBias` in the built layer props increases with
  draw order (e.g. `props[i].u_depthBias === i * 1e-4`).
- A layer carrying a `zAxis` in a 3D plot: assert its `u_depthBias === 0`.
- Assert `depthEnable` is no longer present in the layer props.

---

## Docs

- `docs/configuration/PlotConfiguration.md` — rewrite the branch's "depth off in 2D" note to
  describe always-on depth test + draw-order depth bias (and that it also orders coplanar
  flat layers in 3D).
- `docs/architecture/overview.md` — update the touched line to match.

---

## Out of scope

- The quantity-kind-clash skip logic added on the same branch (unaffected, sound as-is).
- Any change to how genuine 3D layers compute depth.
