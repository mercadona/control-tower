// Pure logic of the dispatcher: slice selection, account map, cmux argv.
export const SERIALIZING_TOUCHES = ['migration', 'ci', 'pbxproj']

// computeReadyCandidates: shared computation of "which issues are in
// status:ready" (`ready`) and, of those, "which have ALL their deps merged"
// (`readyDepsMet`, already sorted by ascending `order` — the same order in
// which selectNext processes them). Extracted (fix round 1 of the W-B review)
// because explainNoSelection re-derived this same chain of filters
// independently of selectNext: the synchrony between the two depended on a
// comment, not on the compiler nor on a test — a future change in the criterion
// for "ready candidate" (a field rename, a new filter) could desynchronise the
// explainer IN SILENCE, letting it confidently assert the wrong cause of a
// block. With this single function as the source of truth, selectNext and
// explainNoSelection can no longer diverge on THIS computation — all that is
// left is the possibility that somebody, in the future, inlines the filter again
// in one of the two places instead of calling here; no automated test detects
// that (it would be a static check of "do not reintroduce this pattern", not of
// behaviour), so it is documented here instead of faked with an assertion that
// would in fact only check this same function against itself.
export function computeReadyCandidates(issues, mergedIssues) {
  const merged = new Set(mergedIssues)
  const ready = issues.filter((i) => i.status === 'ready')
  // D1 finding 2: `i.depsMalformed` (gh-issue-map.js#mapGhIssue) marks an issue
  // whose "## Dependencias" section exists but produced NO recognisable
  // "merge-after #N" at all — almost certainly a human rewrite, not "no
  // dependencies". `deps` in that case is `[]`, so the `.every(...)` below would
  // pass trivially and the issue would be treated as ready to dispatch (the
  // "gate opened in silence" the finding describes) if it were not excluded here
  // explicitly — it is never considered to have "resolved deps" while the real
  // state is unknown.
  const readyDepsMet = ready
    .filter((i) => !i.depsMalformed && (i.deps || []).every((d) => merged.has(d)))
    .sort((a, b) => a.order - b.order)
  return { ready, readyDepsMet }
}

// touchesConflict: the ONLY touches-collision predicate (fix round 2 of the W-B
// review, finding 3 — before, the rule lived duplicated: inline inside
// selectNext's loop, and again, separately, inside collisionAgainstRunning). It
// decides whether `touches` clashes with `claimedTouches` — a literal shared
// token, or (if `hasSerializingClaimed` is true) by entering the serializing
// group migration/ci/pbxproj even though the exact token is a different one. It
// returns `null` if there is no collision, or `{ kind, token }` if there is —
// `token` is what collisionAgainstRunning uses to attribute the collision to a
// concrete issue; selectNext only needs to know whether the result is non-null
// (for the `continue`) and whether `touches` had any serializing touch (to
// update its own batch state, `hasSerializingInBatch` — see below, that state
// accumulation was NOT touched: selectNext is still the one deciding when it
// advances, this helper only centralises the criterion "does this clash?", not
// the loop that uses it).
function touchesConflict(touches, claimedTouches, hasSerializingClaimed) {
  const sharedToken = touches.find((t) => claimedTouches.has(t))
  if (sharedToken) return { kind: 'token', token: sharedToken }
  const serializingTouch = touches.find((t) => SERIALIZING_TOUCHES.includes(t))
  if (serializingTouch && hasSerializingClaimed) return { kind: 'serializing', token: serializingTouch }
  return null
}

export function selectNext(issues, { mergedIssues = [], runningTouches = [], concurrencyCap = 1 } = {}) {
  const claimedTouches = new Set(runningTouches)
  const hasSerializingTouchInRunning = runningTouches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const { readyDepsMet: ready } = computeReadyCandidates(issues, mergedIssues)

  const selected = []
  let hasSerializingInBatch = hasSerializingTouchInRunning
  for (const i of ready) {
    if (selected.length >= concurrencyCap) break
    const touches = i.touches || []
    // collision with what is already running or already selected in this batch
    // (shared token), or a cross-serialization conflict with what has already
    // accumulated in THIS batch (`hasSerializingInBatch`, which does get updated
    // as the loop selects — that accumulation is deliberately loop-local state,
    // not something the shared predicate should know about).
    if (touchesConflict(touches, claimedTouches, hasSerializingInBatch)) continue
    selected.push(i)
    touches.forEach((t) => claimedTouches.add(t))
    if (touches.some((t) => SERIALIZING_TOUCHES.includes(t))) hasSerializingInBatch = true
  }
  return selected
}

// collectInFlight: extracts, from the list of already mapped issues (the same
// shape selectNext consumes: {n, status, touches}), the ones currently in
// status:in-progress — that is, work ALREADY launched by an EARLIER invocation
// of /ct-next (or by claim.js) that is still running. It is the piece that was
// missing: before, ct-next.mjs called selectNext with a hardcoded
// `runningTouches: []`, so two successive invocations of /ct-next --cap 1 never
// saw each other (neither for touches collision nor for the cap). It lives in
// dispatch.js (not in gh-issue-map.js) because it operates on the ALREADY
// MAPPED shape selectNext consumes, not on GitHub's raw JSON — it is the same
// layer of decision, not of format translation.
export function collectInFlight(issues) {
  return (issues || [])
    .filter((i) => i.status === 'in-progress')
    .map((i) => ({ n: i.n, status: 'in-progress', touches: i.touches || [] }))
}

// collectTokenHolders (F13/H2): who is holding area/touches tokens. It is NOT
// the same as collectInFlight, and that is why they are two functions and not
// one with a flag: they are two different RESOURCES with two different criteria.
//
//   - CAP (collectInFlight)        → how many AGENTS are alive right now. Only
//                                    `in-progress`: a slice under review has no
//                                    agent running.
//   - TOKENS (collectTokenHolders) → which areas have work NOT MERGED yet.
//                                    `in-progress` AND `in-review`: the content
//                                    conflict does not end when the agent stops,
//                                    it ends when the PR is merged and `main`
//                                    contains that work.
//
// The full why (including the rejected alternative of keeping the claim at
// `in-progress` until the merge) is in scripts/claim.js, next to
// CLAIM_HOLDING_STATUSES — that is where the same criterion lives for the other
// consumer (dispatch-check.mjs#detectCollisions), and it is not duplicated here
// so that they cannot diverge: the two files describe the same pair of states,
// one over raw labels and the other over the already mapped struct.
export const TOKEN_HOLDING_STATUSES = ['in-progress', 'in-review']
export function collectTokenHolders(issues) {
  return (issues || [])
    .filter((i) => TOKEN_HOLDING_STATUSES.includes(i.status))
    .map((i) => ({ n: i.n, status: i.status, touches: i.touches || [] }))
}

// collisionBlockers (F16/H1): ALL the issues holding something that prevents
// dispatching `cand`, not only the first one `touchesConflict` finds.
//
// THE DEFECT IT CLOSES, observed in the first real run of /ct-next: five issues
// occupied the global serializing lane (four `touches:ci`, one
// `touches:migration`) and the dispatcher named ONE. The problem is not
// incompleteness in the abstract: it is that naming one IMPLIES a remedy
// ("resolve that one and it will come out") that unblocks nothing. Whoever read
// it would resolve that issue, run again, and find themselves just as blocked —
// four times in a row. A candidate's list of blockers is a CONJUNCTION (they all
// have to be cleared), so a sample of size 1 is not "partial information": it is
// a wrong instruction.
//
// And there is a second, more treacherous case that the old attribution could
// not see either: `touchesConflict`'s order returns 'token' before
// 'serializing', so a shared-token collision COVERS a lane collision behind it.
// Verified unfixed with #1 (in-review, touches:ci), #2 (in-review,
// touches:migration) and #3 (ready, touches:ci): the message cited #1 by token;
// after merging #1 a NEW one appeared citing #2 by lane. Two rounds to discover
// two walls.
//
// Shape of each blocker: `{ n, status, sharedTokens, laneTokens }`.
//   - sharedTokens → tokens this holder holds AND `cand` also touches (a literal
//                    area collision).
//   - laneTokens   → serializing tokens this holder holds that block `cand` by
//                    GLOBAL LANE (`cand` touches some migration/ci/pbxproj, even
//                    if it is a different one). The ones already appearing in
//                    `sharedTokens` are excluded so as not to count the same
//                    reason twice.
// A holder appears if at least one of the two is non-empty.
//
// INVARIANT with `touchesConflict` (the ONLY collision predicate, still the one
// deciding selectNext's `continue`): this function returns a non-empty list
// exactly when that one returns non-null — the same two criteria, the same union
// of claimed tokens. It is not used as a gate (the gate is still
// `touchesConflict`, so that they cannot diverge): it only ATTRIBUTES.
export function collisionBlockers(cand, holders) {
  const touches = cand.touches || []
  const candHasSerializing = touches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const normalized = (holders || []).map((h) => ({ n: h.n, status: h.status ?? null, touches: h.touches || [] }))
  const anySerializingHeld = normalized.some((h) => h.touches.some((t) => SERIALIZING_TOUCHES.includes(t)))
  // The lane is only "active" if the candidate enters it AND somebody is inside:
  // otherwise a holder with touches:ci does not block a candidate that touches
  // nothing serializing.
  const laneActive = candHasSerializing && anySerializingHeld
  const out = []
  for (const h of normalized) {
    const sharedTokens = h.touches.filter((t) => touches.includes(t))
    const laneTokens = laneActive
      ? h.touches.filter((t) => SERIALIZING_TOUCHES.includes(t) && !sharedTokens.includes(t))
      : []
    if (sharedTokens.length || laneTokens.length) out.push({ n: h.n, status: h.status, sharedTokens, laneTokens })
  }
  return out
}

// collisionAgainstRunning: given the lowest-order candidate that IS ready with
// merged deps, it decides whether it collides with the work in flight — a
// literal shared token, or a cross-serialization conflict (migration/ci/pbxproj
// with different tokens). null means "it does not collide" (that is: it would be
// selected if there were a cap gap).
function collisionAgainstRunning(cand, inFlight) {
  const runningTouches = inFlight.flatMap((i) => i.touches || [])
  const claimedTouches = new Set(runningTouches)
  const hasSerializingInRunning = runningTouches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const touches = cand.touches || []

  // The same predicate selectNext uses (touchesConflict, above) — the rule of
  // "does this clash?" is a single source of truth; what follows here is ONLY
  // attribution (to which issue in flight, with which token) for the message,
  // which selectNext does not need.
  const conflict = touchesConflict(touches, claimedTouches, hasSerializingInRunning)
  if (!conflict) return null

  // F16/H1: the COMPLETE attribution always travels, alongside the old
  // single-issue one. The `token`/`withIssue`/`withIssueStatus`/`runningToken`
  // fields are kept as they are (tests consume them, as does the single-blocker
  // message, which does not change); `blockers` is what makes it possible to
  // tell the truth when there are several.
  const blockers = collisionBlockers(cand, inFlight)

  // withIssueStatus (F13/H2): for the attribution, the NUMBER of the issue
  // holding the token is no longer enough — IN WHICH STATE it holds it is
  // needed. "collides with #7 (in-progress)" and "collides with #7 (in-review,
  // its PR is still open)" are two blocks with two different remedies, and until
  // F13 the second did not even exist. `?? null` and not an optimistic default:
  // if the caller passed holders without `status` (the old unit tests do), it
  // says it is not known instead of asserting 'in-progress'.
  if (conflict.kind === 'token') {
    const withIssue = inFlight.find((i) => (i.touches || []).includes(conflict.token))
    return { reason: 'collision', kind: 'token', issue: cand.n, token: conflict.token, withIssue: withIssue ? withIssue.n : null, withIssueStatus: withIssue?.status ?? null, blockers }
  }

  const withIssue = inFlight.find((i) => (i.touches || []).some((t) => SERIALIZING_TOUCHES.includes(t)))
  const runningToken = (withIssue?.touches || []).find((t) => SERIALIZING_TOUCHES.includes(t))
  return { reason: 'collision', kind: 'serializing', issue: cand.n, token: conflict.token, runningToken, withIssue: withIssue ? withIssue.n : null, withIssueStatus: withIssue?.status ?? null, blockers }
}

// explainSelectionGap: the same chain of reasons as explainNoSelection, but
// IGNORING the cap entirely — it answers "if the cap were not the limiting
// factor right now (but the work in flight went on holding its tokens), would
// something be selected anyway?". `null` = yes (so raising --cap WOULD help); a
// non-null reason object is what would still be blocking even if the cap did
// not limit.
//
// D2, finding 4 (dispatch audit) — fix: BEFORE, this function looked only at
// `readyDepsMet[0]`, with the reasoning that "selectNext processes in ascending
// order and only skips one per collision, so if the first one does not clash it
// would have been selected". That reasoning is valid for explaining why the REAL
// selectNext, with a REAL cap gap (remainingCap > 0), selected nothing (if the
// [0] did not clash, it would have been selected, contradicting "it selected
// nothing" — therefore, if it selected nothing, the [0] DOES clash, and in fact
// they all do). But it is exactly the WRONG reasoning for the counterfactual
// "would raising --cap help?" in the cap-full case: there `remainingCap` was 0,
// so the real selectNext NEVER examined candidate 2 onwards — that the [0]
// clashes says nothing at all about whether the [1] would too. Reproduced by the
// auditor: cap=2, two in flight (api, db), #20 (order 1, touches:api) clashes
// with the `api` in flight but #21 (order 2, touches:ui) is free — raising --cap
// WOULD dispatch #21, and the old code asserted the opposite by looking only at
// #20.
//
// The correction: scan ALL the ready-with-merged-deps candidates, in the same
// order as selectNext, until finding ONE that does not clash with the work in
// flight — that one is, by construction, the same one
// selectNext(..., concurrencyCap: 1) would pick if the cap gave one more gap
// right now (the work in flight unchanged): selectNext's real loop only stops on
// a collision (`continue`) or on exhausting the cap, so with a single gap
// available it ends up selecting exactly the first one on the list that does not
// clash with `runningTouches`. If NONE of the candidates is free, the first
// one's reason is reported (as before) — the scan does not change WHICH one is
// cited when they really all clash, it only closes the false negative above.
// depStates (F13/H4): `{ <issue number>: <stateReason> }` ONLY for the CLOSED
// issues that do NOT count as merged ('NOT_PLANNED', 'REOPENED', null…). It is
// the information that was missing to be able to answer "why does this slice
// never come out?".
//
// THE HOLE IT CLOSES. `filterMergedIssues` (gh-issue-map.js) considers a dep
// satisfied if its issue is closed with `stateReason === 'COMPLETED'`. Closing a
// discarded slice as **not planned** —which is the semantically correct thing—
// does NOT satisfy the dep, and all its dependants are left waiting FOREVER. The
// message you saw was "falta mergear #7", indistinguishable from "#7 is still
// being worked on": an instruction to wait for something that is never going to
// happen. Verified against the unfixed code: a NOT_PLANNED closure produced
// exactly `unmetDeps:[7]`, with no other signal.
//
// `unmetDeps` keeps its shape (issue numbers, or `null` for an order that
// resolves to no issue) — it is not changed to objects so as not to rewrite the
// existing consumers nor the tests that pin that shape. The state travels apart,
// in a map, and ct-next.mjs#formatReason consults it when rendering.
export function unresolvableDepsOf(blockedEntry, depStates = {}) {
  return (blockedEntry.unmetDeps || []).filter((d) => d != null && Object.prototype.hasOwnProperty.call(depStates, d))
}

function explainSelectionGap(issues, { mergedIssues = [], inFlight = [], depStates = {} } = {}) {
  const { ready, readyDepsMet } = computeReadyCandidates(issues, mergedIssues)
  if (ready.length === 0) {
    // F13: 'none-ready' said "there is nothing to dispatch yet" and kept quiet
    // about there possibly being SIX open PRs waiting for review. With
    // `in-review` holding tokens (H2) that silence is worse still: the most
    // common state at the end of an epic is "everything in review, nothing
    // ready", and the message painted it as though nothing had been started.
    // `inReview` is the list of issues stopped there — zero really means zero.
    // F16/H1, the same lens: "there is nothing to dispatch YET" tells you to wait
    // for something that, with everything in `status:backlog`, is never going to
    // arrive on its own. Promoting backlog → ready is a deliberate HUMAN gate
    // (ct-groom even prints a reminder about it when a groom finishes). Verified
    // unfixed: with three issues in backlog the message was exactly the same as
    // with ZERO open issues — two situations with opposite remedies (promote vs.
    // groom / check --repo), indistinguishable. `total` is the number of OPEN
    // issues that made it this far: zero means there is nothing to look at, not
    // that everything is done.
    const all = issues || []
    return {
      reason: 'none-ready',
      inReview: all.filter((i) => i.status === 'in-review').map((i) => i.n),
      backlog: all.filter((i) => i.status === 'backlog').map((i) => i.n),
      inProgress: all.filter((i) => i.status === 'in-progress').map((i) => i.n),
      total: all.length,
    }
  }
  if (readyDepsMet.length === 0) {
    const merged = new Set(mergedIssues)
    // D1 finding 2: for an issue with depsMalformed, `unmetDeps` is reported
    // empty ON PURPOSE — its real `deps` are unknown (the section could not be
    // read), not "all merged". `malformed: true` is the signal
    // ct-next.mjs#formatReason uses so as not to print an empty list next to
    // "blocked" (an apparent contradiction) and instead explain that the block
    // is due to unreadable data, not to pending work.
    return {
      reason: 'deps-unmet',
      depStates,
      blocked: ready.map((i) => ({
        n: i.n,
        unmetDeps: i.depsMalformed ? [] : (i.deps || []).filter((d) => !merged.has(d)),
        malformed: !!i.depsMalformed,
      })),
    }
  }
  for (const cand of readyDepsMet) {
    const collision = collisionAgainstRunning(cand, inFlight)
    if (!collision) return null // this candidate WOULD be dispatched with one more cap gap
  }
  return collisionAgainstRunning(readyDepsMet[0], inFlight)
}

// explainNoSelection: when selectNext picks nothing, a single generic message
// ("nothing ready with merged deps and without a collision") forces the human to
// guess among four very different causes with different remedies. This function
// distinguishes, in order of priority:
//   1. 'cap-full'    — the cap is already taken up by work in flight. It
//                       includes `wouldDispatchIfCapAllowed` (fix Minor 1 of the
//                       review): without this, a full cap ALWAYS suggested
//                       "raise --cap", even when the candidate that would remain
//                       would also be blocked by another cause (unmerged deps,
//                       or a collision) — raising the cap in that case would
//                       change nothing, and saying otherwise is worse than
//                       saying nothing.
//   2. 'none-ready'  — there is NO issue at all in status:ready.
//   3. 'deps-unmet'  — there are ready ones, but none has all its deps merged.
//   4. 'collision'   — there is at least one ready with merged deps, but it
//                       clashes with work in flight (a shared token, or a
//                       migration/ci/pbxproj serialization conflict).
// `tokenHolders` (F13/H2) is the set holding TOKENS (in-progress + in-review);
// `inFlight` is still the one consuming CAP (only in-progress). When
// `tokenHolders` is not passed (the unit tests predating F13, which only knew
// one set) `inFlight` is used — that way an old call keeps exactly its previous
// semantics instead of silently losing half the holders.
export function explainNoSelection(issues, { mergedIssues = [], inFlight = [], tokenHolders, cap = 1, depStates = {} } = {}) {
  const inFlightCount = inFlight.length
  const holders = tokenHolders ?? inFlight
  // It is computed ALWAYS (even if the cap is already full): it is exactly what
  // is needed to populate `wouldDispatchIfCapAllowed`/`blockedEvenWithCap`
  // without duplicating the collision/deps logic a second time for the "full
  // cap" case.
  const gap = explainSelectionGap(issues, { mergedIssues, inFlight: holders, depStates })
  if (inFlightCount >= cap) {
    // `inFlight` travels whole (not just its count) because the "full cap"
    // message needs to be able to cross EVERY issue occupying the cap against
    // the local evidence that something is really working on it — see F13/H3 in
    // ct-next.mjs#formatBlockReason. Before, only the number arrived, so a DEAD
    // claim taking up the cap without sharing any token with anybody was
    // completely invisible: "raise --cap, or wait for one of them to finish",
    // waiting for an agent that no longer exists.
    return { reason: 'cap-full', inFlightCount, inFlight, cap, wouldDispatchIfCapAllowed: gap === null, blockedEvenWithCap: gap }
  }
  // This should not be reached with consistent data (a non-null `gap` here would
  // mean selectNext would not have selected anything either, for some other
  // reason — but then planDispatch would never have called this function with
  // `selected.length === 0` without it being for precisely that), but we never
  // return undefined in silence in the face of unexpected input.
  return gap ?? { reason: 'unknown' }
}

// planDispatch: composes collectInFlight + selectNext + explainNoSelection in a
// single place, so that ct-next.mjs (the wrapper) never has to decide anything
// on its own — only format what this function already decided. `cap` is the
// GLOBAL maximum of agents working this repository at once (in flight + just
// selected), not a "per invocation" cap: `remainingCap` is what is really passed
// to selectNext as concurrencyCap.
//
// F13/H2 — TWO SETS, NOT ONE. `inFlight` (only `in-progress`) decides the CAP;
// `tokenHolders` (`in-progress` + `in-review`) decides the TOKENS. Before,
// `runningTouches` came out of `inFlight`, so releasing the claim to `in-review`
// when opening the PR released the tokens too — the lock's window ended when the
// PR was opened, while the conflict's window reaches to the merge.
// `remainingCap` is still computed with `inFlight.length`: a PR under review
// occupies nobody.
export function planDispatch(issues, { mergedIssues = [], cap = 1, depStates = {} } = {}) {
  const inFlight = collectInFlight(issues)
  const tokenHolders = collectTokenHolders(issues)
  const runningTouches = tokenHolders.flatMap((i) => i.touches || [])
  const remainingCap = Math.max(0, cap - inFlight.length)
  const selected = selectNext(issues, { mergedIssues, runningTouches, concurrencyCap: remainingCap })
  const blockReason = selected.length === 0 ? explainNoSelection(issues, { mergedIssues, inFlight, tokenHolders, cap, depStates }) : null
  return { selected, inFlight, tokenHolders, runningTouches, remainingCap, blockReason }
}

// ============================================================================
// parseRepoSlug — the only thing surviving from the accounts block (F35).
//
// The account map lived here: resolveAccount, resolveAccountLegacy,
// validateAccountMap, matchesAccountPattern, accountPatternError and
// DEFAULT_AGENT_BIN. They went away whole — the loop no longer evaluates «which
// account does what», and the agent starts with the ambient configuration of
// whoever launches it.
//
// This function stays because it was never about the accounts: ct-status.mjs,
// ct-harvest.mjs and ct-next.mjs use it to reject a malformed `--repo` before
// calling `gh` — without it, a slug with a space inside died with a 404 without
// explaining that the problem was the argument.

// parseRepoSlug: `owner/repo` in lowercase, or `null` if the slug does not have
// exactly that shape. Returning `null` (instead of guessing) is what lets
// ct-next.mjs reject a malformed `--repo` with a clear message instead of
// resolving an account out of something that is not a repository.
export function parseRepoSlug(slug) {
  if (typeof slug !== 'string') return null
  const parts = slug.split('/')
  if (parts.length !== 2) return null
  // No `trim()` on purpose: trimming here would make `--repo " o/r"` pass
  // validation while the REST of the script (the URL of `gh api
  // repos/<repo>/issues`, the workspace title) goes on using the raw string,
  // with the space inside — that is, we would validate one thing and use
  // another. GitHub's owner/repo names are [A-Za-z0-9._-]: any space is an error
  // to warn about, not something to fix in silence.
  if (!parts[0] || !parts[1]) return null
  if (/\s/.test(slug)) return null
  return { owner: parts[0].toLowerCase(), name: parts[1].toLowerCase() }
}
// ============================================================================

export function buildCmuxArgv({ name, cwd, command, env }) {
  const argv = ['new-workspace']
  if (name) argv.push('--name', name)
  if (cwd) argv.push('--cwd', cwd)
  // --env is REPEATABLE and travels inside cmux's PROTOCOL (the CLI client
  // talks over a Unix socket to a daemon ALREADY RUNNING) — unlike
  // `execFileSync('cmux', argv, { env })`, which only sets the environment of
  // cmux's own client process (it dies as soon as it sends the request): the
  // real pty is created by the daemon, which has been running since before with
  // ITS OWN environment fixed at its start-up, so an env var set on the client
  // never reaches the pty. It has to be asked of the daemon explicitly with
  // --env KEY=VALUE. Confirmed live against the real sandbox (T10): without
  // this, the session hangs on claude-account-picker's interactive account
  // selector (waiting for a human typing 1/2 on /dev/tty) instead of starting
  // with CLAUDE_CONFIG_DIR already resolved.
  if (env) for (const [k, v] of Object.entries(env)) argv.push('--env', `${k}=${v}`)
  if (command) argv.push('--command', command)
  return argv
}

// ============================================================================
// F20/H1 — RESEND THE LINE, BECAUSE THERE IS NO WAY NOT TO TYPE IT.
//
// What was measured against this machine's real cmux (and not deduced from the
// help), with seven launches and their screens read:
//
//   - `--command` types: «Send text+Enter to the new workspace after
//     creation». F19 already said so.
//   - `--layout '{"pane":{"surfaces":[{"type":"terminal","command":"…"}]}}'`
//     ALSO types. It is the route F19 left noted as a possible exec and could
//     not test. Measurement: the text appears ECHOED behind the prompt on the
//     session's screen, and the launched process hangs off `-/bin/zsh`
//     (login) → `login -flp … exec -l /bin/zsh` → cmux. And as a bonus,
//     `--cwd` is IGNORED when `--layout` is passed (the measured `$PWD` was the
//     default directory, not the requested one).
//   - `new-surface` accepts no `--command` at all; the only type that runs a
//     binary on its own is `agent-session --provider claude`, which is cmux's
//     own Claude session: it takes neither `claude` arguments nor a prompt, so
//     it is no use for dispatching a slice.
//   - `--env` DOES reach the shell (measured: `CLAUDE_CONFIG_DIR` visible
//     inside), but `ZDOTDIR` does NOT: cmux/Ghostty uses it for its own shell
//     integration and it arrives EMPTY. That is, an rc of our own that starts
//     the agent without typing cannot be injected either.
//
// Conclusion: in this version of cmux there is no exec route at all. The typing
// stays, and what gets hardened is the recovery: if the sentinel does not
// appear, the same line is RESENT to the same session (`send` + `send-key
// Enter`). Whether that is safe depends entirely on the launcher's idempotence
// guard (see launch-sentinel.js#buildLauncherScript).
//
// `send` and `send-key` go SEPARATELY because `cmux send` adds no Enter — it has
// to be sent apart (measured: after a bare `send` the text stays on the edit
// line without executing).
export function buildCmuxSendArgv({ workspace, text }) {
  return ['send', '--workspace', workspace, text]
}

export function buildCmuxSendKeyArgv({ workspace, key = 'Enter' }) {
  return ['send-key', '--workspace', workspace, key]
}

// THE NAME OF A SLICE'S SESSION, in a single place.
//
// It was a loose template inside ct-next.mjs's dispatch loop, and with one
// consumer nothing happened. Now there are TWO: whoever creates the workspace
// (`buildCmuxArgv({ name })`) and whoever looks it up to send it a line — the
// resend of the start-up line, and as of this round the `-OK` watcher, which
// runs in ANOTHER PROCESS and cannot inherit the variable.
//
// And looking it up goes by exact title equality (`w.title === name`): there is
// no stable identifier cmux returns when creating it that we could save, so the
// name IS the handle. One extra space in either of the two copies means the
// watcher never finds the session — it shuts down on its first poll saying it no
// longer exists (exit 4), which is to say that person's go is not delivered and
// the message blames the session instead of the mismatch. It is the same
// decoupling this repository has already paid for three times (JUDGE_TOOLS,
// VERDICT_RULES, PACKAGE_SECTIONS).
export function cmuxSessionName({ repoName, issue, sliceName }) {
  return `${repoName} · #${issue} ${sliceName}`
}

// ============================================================================
// F20/H2 — THE HAPPY PATH COLLECTED NOTHING.
//
// EVERY path in the plugin that deletes a worktree is a FAILURE path: the orphan
// of an aborted dispatch, the worktree blocking a new dispatch, `--requeue`'s
// preconditions. None covers SUCCESS. Observed on the first slice that finished
// well (issue #451 of a real repository): PR merged, issue closed… and
// `.worktrees/451` + `feat/451` were still on disk, and that session's `claude`
// had been alive for THIRTEEN HOURS with its work delivered (read in `cmux
// debug-terminals`: that worktree's surface with `created=48111s`). With six
// slices that is six complete checkouts of the repository, six dead branches and
// six zombie agents.
//
// And there is an added edge: `/ct-next` REFUSES to dispatch if `.worktrees/<n>`
// already exists. The residue of a FINISHED slice blocks any future retry of
// that same slice.
//
// WHY THIS DETECTS AND DOES NOT DELETE. Deleting the worktree of somebody who is
// still working is irreversible, and the plugin has already taken that decision
// twice (`--requeue` requires that neither worktree nor branch remain; F19
// decided not to revert a claim in the face of an absent sentinel). "Merged" is
// not the same as "nobody is touching that": a human may have unpushed changes
// in that worktree, or the agent may still be writing. What is NOT acceptable is
// for nobody ever to mention it — which is what was happening. So it gets named,
// with the exact commands, and the decision to run them is human.
//
// `mergedIssues` is the list of issues closed as *completed* that the dispatcher
// already uses to resolve `merge-after` — that is, exactly "the slices whose
// work is already in the base". No new source is invented.
//
// Shape of each entry: `{ n, worktree, branch, hasWorktree, hasBranch,
// cmuxTitle }`. `cmuxTitle` is `null` if no session was located, and `undefined`
// is never used: "it was not looked at" travels as `cmuxChecked: false` in the
// global result, not camouflaged inside an entry.
export function collectFinishedResidue(mergedIssues, { worktreeDirs = [], branchNames = [], cmuxTitles = null, worktreePathOf, branchNameOf } = {}) {
  const dirs = new Set((worktreeDirs || []).map(String))
  const branches = new Set(branchNames || [])
  const out = []
  for (const n of mergedIssues || []) {
    if (n == null) continue
    const hasWorktree = dirs.has(String(n))
    const branch = branchNameOf ? branchNameOf(n) : `feat/${n}`
    const hasBranch = branches.has(branch)
    if (!hasWorktree && !hasBranch) continue
    // The cmux session title is built by this same dispatcher as
    // `<repo> · #<n> <name>`; here only the `#<n>` is looked for, as a whole
    // token, so as not to match #45 inside #451.
    const cmuxTitle = cmuxTitles === null
      ? null
      : (cmuxTitles.find((t) => new RegExp(`(^|\\s)#${n}(\\s|$)`).test(String(t))) ?? null)
    out.push({
      n,
      worktree: worktreePathOf ? worktreePathOf(n) : `.worktrees/${n}`,
      branch,
      hasWorktree,
      hasBranch,
      cmuxTitle,
    })
  }
  return out.sort((a, b) => a.n - b.n)
}

// formatFinishedResidueWarning: a single warning for the whole pending harvest.
// One per slice would be six identical lines in a repository with six finished
// slices — the same criterion as F16/H1 about the blockers: when the list grows,
// what is actionable is the count and the command, not the breakdown. `null` =
// there is nothing to collect (or it could not be looked at, which the caller
// says).
export function formatFinishedResidueWarning(residue, { repo } = {}) {
  if (!residue || residue.length === 0) return null
  const withSession = residue.filter((r) => r.cmuxTitle)
  const lines = residue.map((r) => {
    const parts = []
    if (r.hasWorktree) parts.push(`worktree ${r.worktree}`)
    if (r.hasBranch) parts.push(`branch ${r.branch}`)
    if (r.cmuxTitle) parts.push(`cmux session "${r.cmuxTitle}" still open`)
    return `  #${r.n}: ${parts.join(', ')}`
  })
  const commands = residue.map((r) => {
    const cmds = []
    if (r.hasWorktree) cmds.push(`git worktree remove --force ${r.worktree}`)
    if (r.hasBranch) cmds.push(`git branch -D ${r.branch}`)
    return `  ${cmds.join(' && ')}`
  })
  const sessions = withSession.length
    ? `\n${withSession.length} of ${withSession.length === 1 ? 'them has' : 'them have'} its cmux session open as well: that \`claude\` is still alive with the work ALREADY delivered (in the case that gave rise to this it had been alive for thirteen hours). Close them by hand once you have checked there is nothing inside — the loop creates agents and until now it buried none of them.`
    : ''
  return `pending harvest: ${residue.length} slice(s) of ${repo || 'this repo'} whose work is ALREADY merged are still leaving residue in this checkout:\n${lines.join('\n')}\nIt is not deleted on its own, and that is deliberate: a worktree may have unpushed changes, and deleting it is irreversible (the same criterion by which \`--requeue\` refuses to act while they exist). Check it and clean it up yourself:\n${commands.join('\n')}\nOr let the guard check it for you: \`node <plugin>/scripts/dispatch-check.mjs <n> --repo ${repo || '<o/r>'} --collect\` closes the cmux session and deletes worktree and branch ONLY if that slice's PR is merged, the tree is clean and the local tip is the commit that landed; if not, it refuses and says which of the three fails (with \`--dry-run\` it only counts it).\nWhile it is still there, \`/ct-next\` will REFUSE to redispatch any of those numbers: the existing worktree is a precondition that cuts the dispatch off.${sessions}`
}
