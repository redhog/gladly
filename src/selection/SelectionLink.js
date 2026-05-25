export function linkSelections(selA, selB) {
  const handleA = selA.subscribe(sel => selB.applyFrom(sel))
  const handleB = selB.subscribe(sel => selA.applyFrom(sel))
  return { unlink: () => { handleA.remove(); handleB.remove() } }
}
