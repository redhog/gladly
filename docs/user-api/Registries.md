# Registries

Functions for registering global definitions.

---

## `registerAxisQuantityKind(name, definition)`

Registers (or merges into) the definition for a quantity kind. Quantity kinds are strings that identify what an axis measures (e.g. `"velocity_ms"`, `"temperature_K"`). Registering a quantity kind lets the library use the correct label and default scale/colorscale everywhere that quantity kind appears, without having to repeat those settings in every `config.axes` block.

```javascript
registerAxisQuantityKind("velocity_ms", {
  label:      "Velocity (m/s)",
  scale:      "linear",
  colorscale: "Blues"
})
```

**Definition fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | `string` | the name itself | Human-readable axis label rendered next to the axis. |
| `scale` | `"linear"` \| `"log"` | `"linear"` | Default scale type for spatial axes using this quantity kind. Can be overridden per-plot in `config.axes[name].scale`. |
| `colorscale` | `string` | — | Default colorscale name for color axes using this quantity kind (e.g. `"viridis"`, `"plasma"`). Can be overridden per-plot in `config.axes[name].colorscale`. |

If `name` was already registered, the new definition is **merged** into the existing one (existing fields that are not present in the new definition are preserved). This differs from `registerLayerType`, which throws on duplicate names.

Quantity kinds do not need to be registered — any string is accepted everywhere a quantity kind is expected. An unregistered name gets `{ label: name, scale: "linear" }` as its implicit definition.

---

## `getAxisQuantityKind(name)`

Returns the definition object for a quantity kind. If `name` has not been registered, returns `{ label: name, scale: "linear" }` without adding it to the registry.

```javascript
const def = getAxisQuantityKind("velocity_ms")
// { label: "Velocity (m/s)", scale: "linear", colorscale: "Blues" }
```

---

## `getRegisteredAxisQuantityKinds()`

Returns an array of all registered quantity kind name strings.

---

## `registerEpsgDef(epsgCode, proj4string)`

Pre-registers a proj4 CRS definition and the matching `epsg_CODE_x` / `epsg_CODE_y` quantity kinds. Use this in environments without network access (air-gapped, offline apps) where the `tile` layer cannot fetch definitions from `epsg.io`.

```javascript
import { registerEpsgDef } from 'gladly-plot'

registerEpsgDef(26911, '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs')
```

The quantity kind labels are looked up from `projnames` (e.g. EPSG:26911 → `"NAD83 / UTM zone 11N X"` and `"NAD83 / UTM zone 11N Y"`). Proj4 strings for any code can be obtained from [epsg.io](https://epsg.io) (append `.proj4` to the code URL).

**When not needed:** In network-connected environments the `tile` layer automatically fetches and registers any unrecognised CRS on first use — `registerEpsgDef` is only required when you need guaranteed offline operation, or when you want to register quantity kinds for scatter/line data before the tile layer initialises.
