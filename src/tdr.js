// Shared TDR (GPU timeout) yield guard.
//
// All GPU draw passes in Gladly call tdrYield() after submitting work.  A
// single shared clock means the 500 ms budget is consumed across the whole
// pipeline, not reset independently per call site — so the browser always
// gets a frame boundary within half a second regardless of how many passes
// are chained together.

const TDR_STEP_MS = 500
let _lastYield = performance.now()

export async function tdrYield() {
  if (performance.now() - _lastYield > TDR_STEP_MS) {
    await new Promise(r => requestAnimationFrame(r))
    _lastYield = performance.now()
  }
}
