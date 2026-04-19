// Browser stub for Node.js child_process — never called in browser context
export default null
export const spawn = () => { throw new Error('child_process not available in browser') }
export const exec  = spawn
export const fork  = spawn
