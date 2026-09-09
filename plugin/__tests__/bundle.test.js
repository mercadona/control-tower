import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { describe, it, expect } from 'vitest'
import { buildOptions } from '../scripts/build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Derived from buildOptions.entryPoints, not repeated by hand: a third list
// of the same bundles would have silently fallen behind the moment the build
// gained an entry point, exactly as already happened to two other lists of
// this same kind in this repo. esbuild, with no `outbase`, names each output
// by the basename of its input inside `outdir` — importing this module fires
// no build (see the `process.argv[1]` guard in build.mjs). entryPoints is a
// MAP (output name → source) ever since scope-check came in from `scripts/`:
// with the list form, esbuild computed a common outbase and nested the outputs
// under `dist/hooks/` and `dist/scripts/`. The derivation is still a derivation
// —the keys ARE the output names—, which is what this line protects: a third
// list written by hand would silently fall behind the moment the build gained
// an entry point, as already happened to two other lists of this same repo.
const bundles = Object.keys(buildOptions.entryPoints).map((nombre) => `${buildOptions.outdir}/${nombre}.js`)

// Extracts the external module specifiers of an ESM bundle.
function externalSpecifiers(code) {
  const out = []
  for (const re of [
    /(?:^|[;\n])\s*import[^;'"]*?from\s*["']([^"']+)["']/g,
    /(?:^|[;\n])\s*import\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1])
  }
  return out
}

describe('self-contained dist bundles', () => {
  for (const b of bundles) {
    it(`${b} exists`, () => {
      expect(existsSync(join(root, b))).toBe(true)
    })
    it(`${b} only imports node: builtins (yaml/state inlined)`, () => {
      const specs = externalSpecifiers(readFileSync(join(root, b), 'utf8'))
      // Accepts both "node:xxx" and the bare name "xxx": both resolve to
      // Node builtins (e.g. esbuild emits require("process") with no prefix
      // inside the __commonJS shim when it inlines yaml). isBuiltin covers
      // both forms; what must NOT appear is a real npm package.
      const nonBuiltin = specs.filter((s) => !isBuiltin(s))
      expect(nonBuiltin).toEqual([])
    })
  }
})
