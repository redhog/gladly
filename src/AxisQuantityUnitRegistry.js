const registry = new Map()

// Initialize with default axis quantity units
const DEFAULT_AXIS_QUANTITY_UNITS = {
  meters: { label: "Meters", scale: "linear" },
  volts: { label: "Volts", scale: "linear" },
  "m/s": { label: "m/s", scale: "linear" },
  ampere: { label: "Ampere", scale: "linear" },
  log10: { label: "Log10", scale: "log" }
}

// Register defaults
for (const [name, definition] of Object.entries(DEFAULT_AXIS_QUANTITY_UNITS)) {
  registry.set(name, definition)
}

export function registerAxisQuantityUnit(name, definition) {
  if (registry.has(name)) {
    // Merge new properties into existing definition
    const existing = registry.get(name)
    registry.set(name, { ...existing, ...definition })
  } else {
    registry.set(name, definition)
  }
}

export function getAxisQuantityUnit(name) {
  if (!registry.has(name)) {
    throw new Error(`Axis quantity unit '${name}' not registered. Available units: ${Array.from(registry.keys()).join(', ')}`)
  }
  return registry.get(name)
}

export function getRegisteredAxisQuantityUnits() {
  return Array.from(registry.keys())
}
