// The GO of the `plan` gate (F38), for the tests that exercise `--release`.
//
// From this round on `dispatch-check --release` has one more gate (exit 9): the
// `plan` gate does not close on its own, and what closes it is an `-OK <nonce>`
// comment carrying THAT dispatch's nonce. That gives any release test two new
// requirements which are not what it is testing: a registered commitment
// (outside the repo, in the coordinator's directory) and a comment that
// satisfies it.
//
// It lives in `fixtures/` rather than copied into each test for the usual
// reason in this repository: the day the registry's format changes, a shared
// fixture breaks once and in one place, and four copies break four times while
// lying about the cause.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { goBody, goCommitment, newGoNonce } from '../../scripts/go-response.js'
import { writeGoCommitment } from '../../scripts/go-registry.js'

// A FIXED nonce: the randomness is supplied by the caller (`newGoNonce` takes
// the bytes), precisely so a test can say which GO is the good one.
export const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
export const GO_HASH = goCommitment(NONCE)
export const GO = goBody(NONCE)

// The comment exactly as `gh issue view --json comments` returns it.
export const goComment = (login = 'josemerca') => ({
  id: 'IC_go', body: GO, createdAt: '2026-08-25T10:00:00Z', author: { login },
})

// Registers a dispatch's commitment and returns the environment variables the
// invocation has to be given: the coordinator's directory where the registry
// lives, and the comments the `gh` stub is going to return.
//
// `given: false` registers the commitment but does NOT place the comment: it is
// the "nobody has given the GO yet" case, which is what gate 9 has to hold
// back.
export function goEnv({ repo = 'o/r', issue = 9, given = true, configDir = null } = {}) {
  const dir = configDir || mkdtempSync(join(tmpdir(), 'ct-go-cfg-'))
  writeGoCommitment({ repo, issue, commitment: GO_HASH, configDir: dir })
  return {
    CLAUDE_CONFIG_DIR: dir,
    FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: given ? [goComment()] : [] }),
  }
}
