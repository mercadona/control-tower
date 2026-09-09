// F8 — deleting a test's temporary directory is HYGIENE, not an assertion, and
// it cannot take down a test that had already passed.
//
// Observed (main @ b0799f3, with another vitest suite running at the same time):
//
//   Error: ENOTEMPTY, Directory not empty: /var/folders/…/ct-next-sig-jUC9MS
//    ❯ __tests__/ct-next-signal-interrupt.test.js:42:35
//
// Cause: when ct-next.mjs kills a child with SIGKILL (its time cap), the
// SIGKILL reaches the child but NOT its grandchildren — the `gh` stubs that
// child had launched stay alive a few milliseconds longer, and they keep
// writing to the log files of the very temporary directory that `afterEach` is
// deleting at that same instant. `rmSync` walks the tree, deletes, and on
// trying to remove the directory finds it populated again. `force: true` does
// NOT cover this: it only ignores "does not exist", not "someone just created
// something here".
//
// No handshake is possible with a process nobody holds a descriptor to any
// more: they are orphaned grandchildren by definition. And there is nothing to
// gain from retrying forever — the directory lives under `os.tmpdir()`, so the
// system carries any residue away. The only thing that matters is that a
// CLEANUP failure does not present itself as a failure of the code under test.
//
// (A side note about the product, not about the tests: that ct-next.mjs's
// SIGKILL does not reach the grandchildren means a `gh issue edit` launched by
// dispatch-check can complete AFTER ct-next has given the child up for dead.
// ct-next's message already says exactly that — "there is no way to know
// whether the claim made it to disk" — so the product does not lie; but it is
// worth writing down where it was observed.)
import { rmSync } from 'node:fs'

export function rmSyncBestEffort(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
  } catch {
    // Residue under os.tmpdir(): irrelevant to the test's verdict.
  }
}
