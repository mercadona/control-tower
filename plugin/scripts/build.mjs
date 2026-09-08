// Bundles the plugin's hooks (one per entry point of buildOptions, below)
// into dist/*.js, self-contained (no npm dependencies at runtime; only
// node:* imports).
//
// The `createRequire` banner below is ESSENTIAL, not cosmetic: the `yaml`
// library internally uses a CommonJS `require()`. When bundling in ESM
// format, that `require` does not exist natively in an ESM module (there is
// no global `require`) and the bundle blows up at runtime with
// "require is not defined". The `createRequire(import.meta.url)` shim
// rebuilds a valid `require` inside the bundle so that the inlined part of
// `yaml` keeps working. If you remove the banner, the hooks compile but fail
// when run. See __tests__/bundle.test.js, which verifies that the resulting
// bundle only imports `node:*` builtins.
import { build } from 'esbuild'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export const RUNTIME_BANNER =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

export const VENDOR_BANNER =
  "import { createRequire as vendorCreateRequire } from 'node:module'; const require = vendorCreateRequire(import.meta.url);"

export const vendorOptions = {
  stdin: {
    contents: "export { parse, stringify } from 'yaml'",
    resolveDir: pluginRoot,
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(pluginRoot, 'scripts', 'vendor', 'yaml.js'),
  banner: { js: VENDOR_BANNER },
}

// buildOptions is exported (F24) so that there is ONE single source of truth
// for the build configuration: whoever needs to rebuild the sources and
// compare the result with the committed `dist/` imports it from here instead
// of carrying their own copy, which would fall behind in silence and would
// take for good a configuration that is no longer the project's.
export const buildOptions = {
  // entryPoints as a MAP (output name → source), not as a list, and this is
  // not cosmetic: as soon as a source from `scripts/` came in alongside those
  // from `hooks/`, esbuild computed a common `outbase` and started writing
  // `dist/hooks/*.js` and `dist/scripts/*.js` instead of the flat `dist/*.js`
  // that hooks.json and ct-init's vendoring expect. The map fixes the output
  // name and stops depending on where the source lives.
  //
  // scope-check is NOT a hook: it is the conformance gate that runs in the
  // TARGET REPO's CI, where the plugin is not installed. It is bundled for the
  // same reason as the hooks —self-contained, no node_modules— and `ct-init`
  // vendors the result alongside the workflow.
  entryPoints: {
    'session-start': 'hooks/session-start.js',
    stop: 'hooks/stop.js',
    'commit-keyword-guard': 'hooks/commit-keyword-guard.js',
    'dispatch-guard': 'hooks/dispatch-guard.js',
    'scope-check': 'scripts/scope-check-cli.js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  banner: { js: RUNTIME_BANNER },
}

// It builds only when EXECUTED (`npm run build`), never when imported — the
// test imports this module and must not trigger a build as a side effect.
// The `process.argv[1]` guard is not over-defensive: under `node -e` that
// value is `undefined`, and without it this would throw `realpathSync(undefined)`
// with ENOENT —and, if that one were not there, `pathToFileURL(undefined)` with
// ERR_INVALID_ARG_TYPE— instead of simply not building.
//
// `realpathSync` is NOT cosmetic: without it the comparison fails OPEN —it
// builds nothing and exits 0— when the path Node ends up resolving for
// `argv[1]` goes through a symlink. `argv[1]` keeps the path EXACTLY AS IT WAS
// INVOKED; `import.meta.url` arrives, BY DEFAULT, with the symlinks already
// resolved.
//
// Not just any symlink triggers it, and it is worth knowing which. Measured on
// macOS with Node 25, without this `realpathSync`:
//   - `cd` into a symlink of the repo and a RELATIVE path
//     (`node scripts/build.mjs`, which is exactly what `npm run build` does):
//     it DOES build. Node resolves the relative path against the PHYSICAL cwd
//     —`process.cwd()` already comes with the symlinks resolved—, so the two
//     strings match.
//   - an ABSOLUTE path that goes through the symlink: it does NOT build.
//   - `scripts/build.mjs` being a symlink itself: it does NOT build, and this
//     case does bite the everyday `npm run build`.
// The last two are the silent failure that leaves the developer in a loop: the
// coherence test asks them for a rebuild that the build refuses to do without
// saying so. With `realpathSync`, all three build.
//
// Two known and accepted limits. Under `--preserve-symlinks-main` —a flag
// `npm run build` does not use— `import.meta.url` does NOT resolve the
// symlinks, the mismatch is inverted and this fix stops matching; checked:
// exit 0 without building. And if `argv[1]` were truthy pointing at something
// non-existent, `realpathSync` would throw ENOENT where before it simply did
// not build; no real invocation of node/npm/vitest reaches that, because when
// `argv[1]` is defined the file exists.
// Do not "simplify" it away.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await build(vendorOptions)
  await build(buildOptions)
}
