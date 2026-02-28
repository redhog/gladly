const registry = new Map()

export function registerLayerType(name, layerType) {
  if (registry.has(name)) {
    throw new Error(`Layer type '${name}' is already registered`)
  }
  registry.set(name, layerType)
}

export function getLayerType(name) {
  if (!registry.has(name)) {
    throw new Error(`Layer type '${name}' not registered. Available types: ${Array.from(registry.keys()).join(', ')}`)
  }
  return registry.get(name)
}

export function getRegisteredLayerTypes() {
  return Array.from(registry.keys())
}
