// THE FAST SUBSET, DERIVED INSTEAD OF DECLARED.
//
// `test:fast` used to be `vitest run --exclude '**/*-real-process.test.js'`,
// and that glob is not the question anybody wanted answered. Measured on this
// tree (168 files, 4503 cases, 308 s of wall clock):
//
//   the glob excludes            14 files    116 cases    195 s   (7.3 %)
//   what really spawns           85 files   1695 cases  2672 s  (99.9 %)
//   what stays in process        83 files   2808 cases     4 s   (0.1 %)
//
// Sixty-two per cent of the cases run in FOUR SECONDS. They were behind a
// subset that saved seven per cent, because the `-real-process` marker is
// carried by 14 files and earned by 85: `__tests__/conforming-modules.test.js`
// enforces the marker, but only over its hand-written list of files born under
// the yardstick, so the 73 that predate the list spawn without saying so.
//
// THE MARKER IS NOT WHAT THIS FILE READS. It reads the same thing the marker
// is supposed to stand for — `SpawningTests.launches`, the detection
// `conforming-modules` already wrote — so the subset is true by construction
// and stays true when a file is added, with nobody having to remember to
// rename it. `__tests__/fast-subset.test.js` is what keeps the two honest.
//
// WHAT IT COSTS, and it has to be said: the fast subset no longer covers the
// state machine, the initialiser or the dispatcher, because every one of those
// is exercised through a subprocess. It is a subset for the edit-run loop and
// never the gate. The gate is `npm test`, unchanged, and the CI runs that one.
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'
import { SpawningTests } from './__tests__/fixtures/spawning-tests.js'

const root = fileURLToPath(new URL('.', import.meta.url))

export default mergeConfig(base, defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', ...SpawningTests.spawning(root)],
  },
}))
