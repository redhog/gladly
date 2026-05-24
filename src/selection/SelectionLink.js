export function linkSelections(selA, selB) {
  const handleA = selA.subscribe(sel => selB._applyFromCpu(sel._packed))
  const handleB = selB.subscribe(sel => selA._applyFromCpu(sel._packed))
  return { unlink: () => { handleA.remove(); handleB.remove() } }
}
