// Pre-bundles CJS packages to ESM for use in @web/test-runner.
// Runs automatically via the `pretest` npm script.
import { rollup } from 'rollup'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('test/vendor', { recursive: true })

for (const pkg of ['regl', 'proj4']) {
  const bundle = await rollup({
    input: pkg,
    plugins: [resolve({ browser: true }), commonjs()],
  })
  const { output } = await bundle.generate({ format: 'esm' })
  writeFileSync(`test/vendor/${pkg}.esm.js`, output[0].code)
  console.log(`bundled ${pkg} → test/vendor/${pkg}.esm.js`)
}
