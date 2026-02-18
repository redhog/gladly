const registry = new Map()

export function registerAxisQuantityKind(name, definition) {
  if (registry.has(name)) {
    // Merge new properties into existing definition
    const existing = registry.get(name)
    registry.set(name, { ...existing, ...definition })
  } else {
    registry.set(name, definition)
  }
}

export function getAxisQuantityKind(name) {
  if (!registry.has(name)) {
    // Return a temporary default definition without registering it
    return { label: name, scale: "linear" }
  }
  return registry.get(name)
}

export function getRegisteredAxisQuantityKinds() {
  return Array.from(registry.keys())
}
