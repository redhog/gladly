#!/usr/bin/env node
// Postinstall patch for @jayce789/numjs:
// Parcel requires dynamic import() specifiers to be string literals for static analysis.
// numjs uses `import(WASM_ENTRY)` where WASM_ENTRY is a variable, so Parcel can't bundle it.
// This script replaces the variable-based import with an equivalent string literal.

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = join(__dirname, '..', 'node_modules', '@jayce789', 'numjs', 'dist', 'chunk-YR56TFHA.js')

let src = readFileSync(target, 'utf8')

const before = 'const module = await import(WASM_ENTRY);'
const after  = 'const module = await import("./bindings/wasm/num_rs_wasm.js");'

if (!src.includes(before)) {
  if (src.includes(after)) {
    console.log('fix-numjs-wasm: already patched, skipping.')
  } else {
    console.warn('fix-numjs-wasm: target string not found — patch may be out of date.')
  }
  process.exit(0)
}

writeFileSync(target, src.replace(before, after), 'utf8')
console.log('fix-numjs-wasm: patched chunk-YR56TFHA.js successfully.')
