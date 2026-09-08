// F8 — AN EXPLICIT HANDSHAKE FOR THE STUBS, INSTEAD OF A TIME WINDOW.
//
// Several tests need the process under test to be STOPPED at one precise point
// while the harness does something (typically: sending it a signal). Until F8
// that was achieved by having the stub sleep a fixed number of milliseconds
// (FAKE_GH_EDIT_DELAY_MS, FAKE_GIT_WORKTREE_ADD_DELAY_MS,
// CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS) and trusting that the harness would get
// there in time inside that window.
//
// That is a race, not a synchronisation. The window is fixed by a number
// written by hand; the one that has to get there in time is a node process
// competing for CPU with the rest of the suite (and with whatever else is
// running on the machine). With the machine idle the harness reacts in
// milliseconds and the 2000ms window looks infinite; under load, that same
// harness may not be scheduled for several seconds and the window closes by
// itself. It is exactly the same reasoning error this project already banished
// from the claim protocol when it withdrew the "settle".
//
// `waitForReleaseFile` inverts the responsibility: the stub STOPS and does not
// carry on until the test itself tells it that it may, by creating a sentinel
// file. The test no longer has to get anywhere in time — the process under
// test waits for it, however long it takes.
//
// The time cap that does remain (`capMs`) is NOT synchronisation: it is a
// rescue so that a badly written test (one that never creates the sentinel)
// fails noisily instead of hanging the runner for ever. That is why it exits
// with a distinctive code and writes to stderr instead of carrying on as if
// nothing had happened: a stub that carried on in silence once the cap ran out
// would reintroduce, with no warning, exactly the race this file exists to
// remove.
import { existsSync } from 'node:fs'

export const RELEASE_FILE_TIMEOUT_EXIT = 97

export function waitForReleaseFile(varName, capMs = 120_000) {
  const path = process.env[varName]
  if (!path) return
  const deadline = Date.now() + capMs
  // A really BLOCKING wait (Atomics.wait over a SharedArrayBuffer): these
  // stubs are synchronous processes from top to bottom, and what they have to
  // simulate is a binary that has not come back yet.
  const sab = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      console.error(`stub: ${varName}: el centinela "${path}" no apareció en ${capMs}ms — el test nunca lo creó. Se aborta en vez de continuar (continuar en silencio devolvería la carrera de temporización que este handshake quita).`)
      process.exit(RELEASE_FILE_TIMEOUT_EXIT)
    }
    Atomics.wait(sab, 0, 0, 5)
  }
}
