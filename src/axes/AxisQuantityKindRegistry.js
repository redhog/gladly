const registry = new Map()

export function registerAxisQuantityKind(name, definition) {
  // '__' is reserved as the Axis2d pair-key separator ("<qkX>__<qkY>"), so a
  // quantity-kind name must not contain it — otherwise a 2D pair key would split
  // ambiguously. See src/axes/Axis2d.js.
  if (name.includes('__')) {
    throw new Error(`Quantity kind name '${name}' must not contain '__' (reserved as the Axis2d pair-key separator)`)
  }
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

// Returns 1.0 for log scale, 0.0 for linear. axesConfig is the `axes` sub-object of plot config.
export function getScaleTypeFloat(quantityKind, axesConfig) {
  const configScale = axesConfig?.[quantityKind]?.scale
  const defScale = getAxisQuantityKind(quantityKind).scale
  return (configScale ?? defScale) === "log" ? 1.0 : 0.0
}
