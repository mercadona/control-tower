// A HERMETIC environment for the tests that invoke ct-next.mjs.
//
// ct-next's preflight checks things about the machine's REAL environment: that
// `cmux` and the agent's binary are on the PATH. Without these stubs the suite
// would depend on what whoever runs it happens to have installed — and, worse,
// a test could launch a REAL cmux workspace (it happened once in this project).
//
// Tests that want to exercise the ABSENCE of a binary set their own PATH (see
// ct-next-preconditions.test.js) — never by omitting the stub and trusting the
// real binary is not there.
//
// F35: two account directories used to live here as well (TEST_PERSONAL_DIR /
// TEST_WORK_DIR) plus the ACCOUNT_ENV that injected them, because the preflight
// demanded the resolved CLAUDE_CONFIG_DIR exist on disk. When account
// resolution left, they left with it: there is nothing left to point at.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// Stubs of binaries the preflight only LOOKS UP on the PATH (statSync +
// accessSync), never executes.
export const FAKE_BIN_DIRS = [
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
]

// hermeticEnv: the environment base for any invocation of ct-next.mjs in the
// tests. `pathPrefix` is whichever stub directories that test wants in front
// (git/gh/cmux).
export function hermeticEnv(pathPrefix = []) {
  return { PATH: [...pathPrefix, ...FAKE_BIN_DIRS, process.env.PATH].join(':') }
}
