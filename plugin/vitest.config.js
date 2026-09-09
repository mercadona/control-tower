// F8 — WHY THIS FILE EXISTS.
//
// Until now the suite had no configuration file, so it ran with vitest's
// DEFAULT `testTimeout`: 5000 ms. That number was, without anybody having
// decided it, the pass condition of almost the whole suite.
//
// Hardly any test in this repo is a pure function. The ct-next / ct-groom /
// dispatch-check ones start the REAL script as a subprocess, and that script
// in turn starts `git`, `gh` and `cmux` (stubs, yes, but real node processes,
// each with its full V8 start-up). One end-to-end `--cap 2` case chains
// something of the order of twenty node start-ups. With the machine idle that
// is 1-3 s: below the 5 s, but only just, and without anybody having checked
// it.
//
// Measured in this repo (main @ b0799f3 UNTOUCHED, with another complete
// vitest suite running in a loop at the same time, 6 runs in a row):
//   19, 23, 9, 23, 15 and 31 tests failed out of 836. Zero green runs.
//   Of those 120 failures, 116 were literally "Test timed out in 5000ms" —
//   not a single AssertionError. Real durations of tests that "failed":
//   17427, 16814, 16261, 15242, 12204, 10107, 9773, 9717, 8721 ms…
//
// RAISING THIS NUMBER IS NOT COVERING UP A TEST THAT LIES, and the
// distinction matters because it is exactly the trap this task came to
// dismantle. A `testTimeout` is a HANG DETECTOR, not a synchronisation
// mechanism. None of the tests that fell over because of it asserts ANYTHING
// about how long something takes: all their assertions are about the exit
// code, the output text and the files left on disk. At 5 s the deadline did
// not mean "this has hung", it meant "the machine was busy" — and the failure
// report was indistinguishable from that of a genuinely broken assertion. At
// 120 s only a real hang can fire it, and the verdict in the face of a real
// hang is still the same as before: it fails. It just takes longer to arrive,
// which is exactly what is asked of a safety net.
//
// The places where the clock really WAS the synchronisation or the assertion
// (and not a safety deadline) have NOT been fixed by raising any number — see
// CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE in scripts/ct-next.mjs,
// FAKE_GIT_WORKTREE_ADD_WAIT_FILE in __tests__/fixtures/fake-git-bin/git, and
// the paired measurements of dispatch-check-dryrun.test.js.
//
// hookTimeout: the same reasoning for the `afterEach` hooks (which delete
// trees of temporary directories); their default is 10 s and under load it
// comes out just as short.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // CT_WATCH_GO_BIN — NO test launches the real `-OK` watcher.
    //
    // `ct-next` launches it DETACHED after dispatching a slice with a `plan`
    // gate, that is, in most of the tests that dispatch anything. Measured the
    // first time the suite ran with this in place: 42 orphaned
    // `ct-watch-go.mjs` processes, each one polling every 30 s for eight
    // hours. A `pkill` after every run is not a solution: the suite cannot
    // leave processes behind, full stop.
    //
    // It goes here and not in each test because the defect is exactly that: a
    // test that does NOT talk about this launching it by accident. The three
    // files that do talk about it set their own value and do not depend on
    // this one.
    //
    // The recorder, besides polling nothing, notes down its argv when the test
    // gives it a FAKE_WATCH_GO_LOG — so the same double serves both to do no
    // harm and to check that the launch happens with the right arguments.
    // CT_WATCH_MERGE_BIN — the same for the MERGE watcher, which
    // `dispatch-check --release` launches detached. `--release` is exercised
    // in many more tests than the ones that talk about it (all the e2e
    // correspondence ones, the dry-run ones, the truncation ones), so without
    // this each one would leave a process polling GitHub every minute for 48
    // hours. It is exactly the defect CT_WATCH_GO_BIN came to close; that it
    // is here and not in each test is the point.
    env: {
      // `fileURLToPath` and not `.pathname`: with the checkout under a path
      // with spaces or non-ASCII, `.pathname` comes percent-encoded and would
      // point at a file that does not exist. It is what the repo's other 56
      // files use.
      CT_WATCH_GO_BIN: fileURLToPath(new URL('./__tests__/fixtures/fake-watch-go-bin/recorder.mjs', import.meta.url)),
      CT_WATCH_MERGE_BIN: fileURLToPath(new URL('./__tests__/fixtures/fake-watch-merge-bin/recorder.mjs', import.meta.url)),
    },
  },
})
