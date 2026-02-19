/**
 * Links two Axis (or duck-typed axis) objects bidirectionally.
 *
 * When either axis's domain changes via setDomain(), the other is updated to match.
 * Quantity kinds are validated at link time if both are known.
 *
 * Returns an object with an unlink() method to tear down the link.
 *
 * Any object that implements the Axis interface may be used:
 *   { quantityKind, getDomain(), setDomain(domain), subscribe(cb), unsubscribe(cb) }
 */
export function linkAxes(axis1, axis2) {
  const qk1 = axis1.quantityKind
  const qk2 = axis2.quantityKind
  if (qk1 && qk2 && qk1 !== qk2) {
    throw new Error(`Cannot link axes with incompatible quantity kinds: ${qk1} vs ${qk2}`)
  }

  const cb1 = (domain) => axis2.setDomain(domain)
  const cb2 = (domain) => axis1.setDomain(domain)

  axis1.subscribe(cb1)
  axis2.subscribe(cb2)

  return {
    unlink() {
      axis1.unsubscribe(cb1)
      axis2.unsubscribe(cb2)
    }
  }
}
