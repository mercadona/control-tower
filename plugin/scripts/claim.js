// Pure logic of the hardened claim (GitHub labels used as a lock).
function tokensOf(labels) {
  return (labels || []).filter((l) => l.startsWith('area:') || l.startsWith('touches:'))
}

export function conflictTokens(candLabels, otherLabels) {
  const other = new Set(tokensOf(otherLabels))
  return tokensOf(candLabels).filter((t) => other.has(t))
}

// ============================================================================
// F13/H2 — THE LOCK'S WINDOW WAS SHORTER THAN THE CONFLICT'S WINDOW.
//
// Before, the only status that held tokens was `status:in-progress`. But the
// kickoff tells the agent to run `--release` WHEN IT OPENS THE PR
// (kickoff.js), and `--release` moves it to `status:in-review`. Between that
// instant and the MERGE there is a window —minutes, hours or days— in which:
//   - the next candidate sees its area free and gets dispatched;
//   - `/ct-next` branches `feat/<n>` off the base (`main`), which does NOT YET
//     contain the previous slice's work;
//   - two live branches touch the same domain, with no rule preventing it.
// Reproduced against the unfixed code: `detectCollisions(['touches:db'],
// [{n:5, labels:['status:in-review','touches:db']}])` returned `[]`.
//
// WHY THIS OPTION AND NOT "HOLD THE CLAIM UNTIL THE MERGE". The other obvious
// route was not to release `in-progress` until the merge (having the agent NOT
// call `--release` when it opens the PR). It is rejected for two reasons:
//   1. `in-progress` is also the CAP's currency (`collectInFlight` in
//      dispatch.js). A PR that takes three days to be reviewed would consume a
//      concurrency slot for three days — but there is no agent running there:
//      the cap measures LIVE AGENTS, and that is a real and different
//      resource. Melting the two resources into a single label makes fixing
//      one break the other.
//   2. The detection of stale claims (`stalenessNote` in ct-next.mjs) treats
//      an `in-progress` with no worktree/branch/session as possibly orphaned.
//      A PR under review WITHOUT a live session is the NORMAL case, not an
//      anomaly: with the other route, every slice under review would fire a
//      false orphaned-claim alarm.
// That is why the two resources are kept apart: `in-review` holds TOKENS (the
// content conflict lasts until the merge, just like `merge-after`) but does
// NOT consume CAP (there is no live agent to count). One status, two different
// books, each with its own criterion.
//
// A CONSEQUENCE THAT HAS TO BE SAID OUT LOUD (and is said: ct-next.mjs tells
// the collision message against `in-review` apart from the one against
// `in-progress`): this NARROWS what the loop accepts. A slice that used to go
// out while the previous PR was under review now waits for the merge. It is
// deliberate — branching off a base without the work you depend on is exactly
// what `merge-after` exists to prevent — and it creates a new category of
// refusal ("blocked by an open PR") that needs a voice of its own, not the
// generic "wait until it finishes".
//
// And a second category, born of the first: a PR ALREADY MERGED whose issue
// nobody closed (the PR did not carry "Closes #N") stays in `in-review`
// forever holding its tokens. That used to be harmless; now it blocks. The
// collision message against `in-review` names it explicitly and gives the
// command to close it.
// ============================================================================
export const CLAIM_HOLDING_STATUSES = ['status:in-progress', 'status:in-review']

// holdingStatusOf: which of the token-holding statuses this issue carries, or
// `null` if none. It returns the status (not a boolean) because whoever asks
// needs to be able to SAY which one it is: "there is an agent working on it"
// and "its PR is open and unmerged" are two situations with two different
// remedies, and collapsing them into "it collides" is exactly what left the
// window nameless for the whole life of the loop.
export function holdingStatusOf(labels) {
  const ls = labels || []
  return CLAIM_HOLDING_STATUSES.find((s) => ls.includes(s)) ?? null
}

export function detectCollisions(candLabels, openIssues) {
  const out = []
  for (const iss of openIssues) {
    const status = holdingStatusOf(iss.labels)
    if (!status) continue
    const tokens = conflictTokens(candLabels, iss.labels)
    if (tokens.length) out.push({ n: iss.n, tokens, status })
  }
  return out
}

// claimLost still looks ONLY at `status:in-progress`, on purpose (F13/H2 — it
// is not an oversight). It is a TIE-BREAK between two simultaneous claimants,
// not a conflict check: both are in `in-progress` by definition (they have
// just written their claim). An issue in `in-review` is not competing for
// anything — it won its claim a while ago and half-released it — and
// `detectCollisions` (step 1, BEFORE writing) already sees it and aborts, so
// this is never reached with a colliding `in-review` ahead. Widening the
// tie-break to `in-review` would only add one more way of losing a race
// against somebody who is not running.
export function claimLost(readback, self) {
  const mine = readback.find((i) => i.n === self)
  // Our issue does not show up in the readback → ambiguous state, we do not block.
  if (!mine) return false
  for (const iss of readback) {
    if (iss.n === self) continue
    if (!(iss.labels || []).includes('status:in-progress')) continue
    const shared = conflictTokens(mine.labels, iss.labels).length > 0
    if (shared && iss.n < self) return true // deterministic tie-break: the lower number wins
  }
  return false
}
