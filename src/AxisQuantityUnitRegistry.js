const registry = new Map()

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
    // Return a temporary default definition without registering it
    return { label: name, scale: "linear" }
  }
  return registry.get(name)
}

export function getRegisteredAxisQuantityUnits() {
  return Array.from(registry.keys())
}
