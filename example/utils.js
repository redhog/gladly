/**
 * Helper to create property accessor (repl regl.prop which may not be available)
 * @param {string} path - Dot-separated path to property (e.g., "data.x")
 * @returns {Function} Accessor function that extracts the property from props
 */
export const prop = (path) => (context, props) => {
  const parts = path.split('.')
  let value = props
  for (const part of parts) value = value[part]
  return value
}
