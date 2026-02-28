import { registerAxisQuantityKind } from "../src/index.js"
import { } from "../src/PointsLayer.js"
import { } from "../src/LinesLayer.js"
import { } from "../src/Filterbar.js"
import { } from "./layer-types/MultiLineLayer.js"

export { data } from "./data/sampleData.js"

registerAxisQuantityKind("voltage_V",            { label: "Voltage (V)",           scale: "linear", colorscale: "viridis"   })
registerAxisQuantityKind("distance_m",           { label: "Distance (m)",          scale: "linear", colorscale: "plasma"    })
registerAxisQuantityKind("current_A",            { label: "Current (A)",           scale: "linear", colorscale: "inferno"   })
registerAxisQuantityKind("reflectance_au",       { label: "Reflectance (a.u.)",    scale: "linear", colorscale: "magma"     })
registerAxisQuantityKind("incidence_angle_rad",  { label: "Incidence angle (rad)", scale: "linear", colorscale: "Spectral"  })
registerAxisQuantityKind("temperature_K",        { label: "Temperature (K)",       scale: "linear", colorscale: "coolwarm"  })
registerAxisQuantityKind("velocity_ms",          { label: "Velocity (m/s)",        scale: "linear", colorscale: "Blues"     })
registerAxisQuantityKind("line_index",           { label: "Channel",               scale: "linear", colorscale: "Spectral"  })
