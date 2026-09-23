// WHO LAUNCHES A REAL PROCESS, decided once and read by everyone who needs it.
//
// The rule already existed, in `__tests__/conforming-modules.test.js`: a test
// that launches a real process carries `-real-process` in its file name. What
// did not exist was anybody applying it BEYOND the hand-written list of files
// born under the yardstick, and the consequence was measurable: `test:fast`
// excluded `**/*-real-process.test.js` and, with that glob, removed 14 files
// worth **7.3 %** of the suite's time. The 87 spawning files that predate the
// list kept running, and with them 89 % of the cost. A fast subset that saves
// seven per cent is not a fast subset — it is the whole suite with a shorter
// name.
//
// The detection is the one `conforming-modules` already used, moved here so
// there is ONE definition and not two that can drift: a file launches a real
// process if it imports `node:child_process`, or if it imports a fixture under
// `__tests__/fixtures/` that does — transitively, because
// `ct-step-harness.js` is what spawns for the whole `ct-step-*` family and
// none of those files names `child_process` itself.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CHILD_PROCESS = /(?:from\s+['"]node:child_process['"]|require\(\s*['"]node:child_process['"]\s*\))/
const RELATIVE_IMPORT = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g
const FIXTURES = '__tests__/fixtures/'

export class SpawningTests {
  static MARKER = '-real-process.test.js'

  static launches(root, path, seen = new Set()) {
    if (seen.has(path)) return false
    seen.add(path)
    const source = SpawningTests.#read(root, path)
    if (source === null) return false
    if (CHILD_PROCESS.test(source)) return true

    return [...source.matchAll(RELATIVE_IMPORT)]
      .map(([, specifier]) => join(dirname(path), specifier))
      .filter((imported) => imported.startsWith(FIXTURES))
      .some((imported) => SpawningTests.launches(root, imported, seen))
  }

  static all(root) {
    return readdirSync(join(root, '__tests__'))
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => join('__tests__', name))
      .sort()
  }

  // THE MARKER COUNTS TOO, and it is not belt and braces. `launches` reads the
  // TEST's imports, and a test can spawn without naming `child_process`: it
  // drives production code that does. Measured here —
  // `baseline-real-process.test.js` runs `ShellBaselineRunner`, which starts a
  // shell, and `cmux-real-process.test.js` runs `CmuxWorkspaceQuery`, which
  // starts `cmux` — two files the detection alone calls quiet and that are not
  // quiet at all. Neither sits on the hand-written list of
  // `conforming-modules`, so nothing had ever measured them.
  //
  // So the answer is the UNION: what the detection finds, plus what a human
  // declared by naming the file. The marker keeps being a claim a person makes
  // and the detection keeps being the floor under it; one covers the other's
  // blind spot and no file has to be renamed for that to hold.
  static spawning(root) {
    return SpawningTests.all(root).filter((path) =>
      path.endsWith(SpawningTests.MARKER) || SpawningTests.launches(root, path)
    )
  }

  static inProcess(root) {
    const spawning = new Set(SpawningTests.spawning(root))

    return SpawningTests.all(root).filter((path) => !spawning.has(path))
  }

  static #read(root, path) {
    try {
      return readFileSync(join(root, path), 'utf8')
    } catch {
      return null
    }
  }
}
