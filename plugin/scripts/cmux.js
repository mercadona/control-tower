// ============================================================================
// CMUX — the ONLY copy of the workspace walk, and the only one that knows
// cmux's schema is not guaranteed.
//
// WHY THIS FILE EXISTS. Until this round the same walk (`list-windows --json`
// plus one `workspace list --window <id> --json` per window) lived in THREE
// places, and only one of them was right:
//
//   - `ct-next.mjs#queryAllCmuxWorkspaces` — hardened by two external reviews,
//     with the complete schema guard that sits further down.
//   - `ct-watch-go.mjs#consultarSesion` — raw, matching by `custom_title`.
//   - `ct-watch-merge.mjs#consultarCoordinadora` — raw, matching by
//     `current_directory`.
//
// An adversarial review on #37 caught it, and its sharpest observation was not
// the duplication: it was that the merge watcher had IMPROVED its error message
// just before. The old message («no existe ninguna sesión en <cwd>») was vague
// and useless; the new one names the rule and tells the person what they did
// wrong. With the raw read, a field rename in cmux turns that into a specific,
// confident and FALSE accusation — and this repo has a whole test file
// (`ct-next-honest-messages.test.js`) against that exact class of message. So
// the improvement in honesty, without the guard, made the failure mode worse.
//
// It is the decoupling this repo already paid for with JUDGE_TOOLS,
// VERDICT_RULES and PACKAGE_SECTIONS, and here with an aggravating factor: the
// three copies were not the same, and the one that was right was the one least
// read.
//
// THIS MODULE IS NOT PURE, and that is why it does not live in `dispatch.js`.
// That one declares itself "the dispatcher's pure logic" and holds cmux's argv
// builders (`buildCmuxSendArgv`, `cmuxSessionName`); this one launches
// subprocesses. They are two different subjects and they are kept apart: the
// same reason why `harvest.js` is pure and `ct-harvest.mjs` does the IO.
// ============================================================================

import { execFileSync } from 'node:child_process'

// 5 seconds, the value this query was born with in ct-next.mjs. It is exported
// because the two watchers each had their own constant (10 s) for the SAME
// query: two numbers for the same thing is a divergence waiting for somebody to
// tune one and believe they have tuned both. Whoever needs another deadline
// passes it in.
export const CMUX_QUERY_TIMEOUT_MS = 5000

// ---------------------------------------------------------------------------
// listCmuxWorkspaces: a READ-ONLY query of every workspace of every window. It
// returns an array of `{title, cwd, cwdKnown, ref}`, or `null` if the result is
// INCONCLUSIVE.
//
// By default, one failed window does not invalidate the other windows. This
// preserves the contract for existing consumers. With `requireComplete: true`,
// any failed window query returns `null`. Zero windows remains conclusive and
// returns `[]`.
//
// THE DISTINCTION THAT HOLDS EVERYTHING UP: `null` (it could not be known) is
// not `[]` (cmux answered and there really is none). Something different
// follows from each of them in each of the three consumers, and confusing them
// is the defect this module centralises.
//
// IMPORTANT (external review): `custom_title`/`current_directory` are the field
// names observed against the version of cmux installed on the development
// machine — there is no guarantee of version or of schema. If the real name
// were to change, EVERY `ws.custom_title` would be `undefined`, the
// `typeof === 'string'` further down would fail, and the result would silently
// filter down to an empty array — indistinguishable, before this guard, from
// "cmux answered and there really is no session". That degraded EVERY
// staleness-check into a false "abandoned" and EVERY launch verification into a
// false "not-found", both of them noisy.
// `sawAnyWorkspaceEntry`/`sawAnyRecognizedTitle` tell the two causes of "zero
// results" apart: if there really were entries (`parsed.workspaces` not empty)
// but NONE of them had the expected field, a schema change is far more likely
// than "genuinely zero sessions" — it is treated as INCONCLUSIVE. If there
// never was any entry in any window (the normal, expected case of "nothing is
// open"), it is still a confident `[]`.
//
// WHAT "RECOGNISING THE FIELD" CANNOT MEAN. The first version of this guard
// demanded a STRING, and with that it swallowed the commonest case there is: a
// cmux terminal with no title set carries `custom_title: null` (with its
// `has_custom_title: false` alongside). Which means anybody with a terminal
// open and no plan under way —the normal start-up, including that of whoever
// launches the backend FROM cmux— fell into "there were entries and none with a
// title" and got an INCONCLUSIVE: `GET /active-plans` answered 503
// `active-plans-recovery-inconclusive` and the front end planted "No se puede
// saber qué hay en marcha" before anything could be done. The guard against
// false certainty had turned into a PERMANENT false uncertainty, which is the
// same sin from the other side. The right line is not string-vs-rest, it is
// field PRESENT (string or `null`: cmux has answered) vs field ABSENT
// (`undefined`: we do not know whether we understand this schema).
//
// D5, finding B — the guard above covered `custom_title` and NOTHING ELSE:
// `current_directory` was read bare (`ws.current_directory ?? null`) and then
// compared with STRICT equality against the expected worktree. If cmux were to
// rename ONLY that field (the title would still be recognised, so
// `sawAnyRecognizedTitle` would save nothing), every `cwd` would be `null`,
// `null !== <worktree>` and EVERY correct launch would be classified as
// 'wrong-cwd' — that is, exactly the false alarm the `custom_title` guard exists
// to prevent, and with an exit-code consequence on top: since 'wrong-cwd'
// stopped counting as launched, a whole repo would go from exit 0 to exit 3
// with nothing being wrong.
//
// The fix, applied to BOTH fields and not to one: a field whose schema we do not
// recognise degrades to INCONCLUSIVE, never to "verified to be wrong". For the
// cwd the degradation is PER ENTRY (`cwdKnown`), not global like the title's:
// that way it also behaves well in the face of a mixed fleet (some entries with
// the field, others without it), and of a session that legitimately exposes no
// directory. Whoever consumes this translates `cwdKnown: false` into a state of
// its own ('cwd-unknown' in `verifyCmuxLaunch`), never into 'wrong-cwd'.
// ---------------------------------------------------------------------------
export class CmuxAnswer {
  static answered(entries) {
    return new CmuxAnswer(entries, null)
  }

  static refused(reason) {
    return new CmuxAnswer(null, reason)
  }

  constructor(entries, reason) {
    this.entries = entries
    this.reason = reason
    Object.freeze(this)
  }

  get wasAnswered() {
    return this.reason === null
  }
}

export class CmuxWorkspaceQuery {
  static ask({ timeoutMs = CMUX_QUERY_TIMEOUT_MS, run = ejecutar, requireComplete = false } = {}) {
    let windows
    try {
      windows = JSON.parse(run(['list-windows', '--json'], timeoutMs))
    } catch (cause) {
      return CmuxWorkspaceQuery.#refused(`cmux could not be asked for its windows: ${CmuxWorkspaceQuery.#saidBy(cause)}`)
    }
    const out = []
    let sawAnyWorkspaceEntry = false
    let sawAnyKnownTitleField = false
    let fieldsSeen = []
    for (const w of (Array.isArray(windows) ? windows : [])) {
      if (!w || !w.id) continue
      try {
        const parsed = JSON.parse(run(['workspace', 'list', '--window', w.id, '--json'], timeoutMs))
        const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
        for (const ws of workspaces) {
          sawAnyWorkspaceEntry = true
          if (ws !== null && typeof ws === 'object') fieldsSeen = Object.keys(ws)
          // The field counts as KNOWN whether it carries a string or `null`:
          // `null` is cmux saying "this workspace has no title set" (its
          // `has_custom_title: false` corroborates it), and that is an answer,
          // not a gap. The rename this guard watches for leaves the field
          // ABSENT (`undefined`), and only that is still inconclusive.
          if (ws && (typeof ws.custom_title === 'string' || ws.custom_title === null)) {
            sawAnyKnownTitleField = true
          }
          if (ws && typeof ws.custom_title === 'string') {
            const cwdKnown = typeof ws.current_directory === 'string'
            // F20/H1: `ref` (e.g. "workspace:97") is the handle
            // `cmux send --workspace` accepts. It degrades to `null` with the
            // SAME criterion as the cwd —per entry, never global— because its
            // absence invalidates nothing of what was already known: it only
            // means the line cannot be forwarded to THAT session, and whoever
            // needs to must be able to say so instead of sending a `send` to
            // `undefined`.
            const ref = typeof ws.ref === 'string' && ws.ref.length > 0 ? ws.ref : null
            out.push({ title: ws.custom_title, cwd: cwdKnown ? ws.current_directory : null, cwdKnown, ref })
          }
        }
      } catch (cause) {
        // The default mode keeps results from the other windows. Complete mode
        // cannot reach a conclusion if one window is missing.
        if (requireComplete) {
          return CmuxWorkspaceQuery.#refused(
            `cmux could not be asked for the workspaces of window ${w.id}: ${CmuxWorkspaceQuery.#saidBy(cause)}`
          )
        }
      }
    }
    if (sawAnyWorkspaceEntry && !sawAnyKnownTitleField) {
      return CmuxWorkspaceQuery.#refused(
        'cmux listed workspaces and none of them exposes custom_title: this is not the schema this reads, ' +
        `it answered with ${fieldsSeen.join(', ')}`
      )
    }

    return CmuxAnswer.answered(out)
  }

  static #refused(reason) {
    return CmuxAnswer.refused(reason)
  }

  static #saidBy(cause) {
    const written = typeof cause.stderr === 'string' ? cause.stderr.trim() : ''
    if (written === '') return cause.message

    return cause.code === undefined ? written : `${cause.message}: ${written}`
  }
}

export function listCmuxWorkspaces(opts = {}) {
  return CmuxWorkspaceQuery.ask(opts).entries
}

function ejecutar(argv, timeoutMs) {
  return execFileSync('cmux', argv, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL',
  })
}

// ---------------------------------------------------------------------------
// THE WATCHERS' TWO FINDERS. They return `{ consultado, ref }`, which is the
// shape both of them already held up separately:
//
//   { consultado: true,  ref: '<handle>' } → it is there, and can be typed into.
//   { consultado: true,  ref: null }       → cmux answered and it is NOT there.
//   { consultado: false, ref: null }       → it could not be known.
//
// The third is the one a raw read loses, and losing it has opposite
// consequences in the two watchers: the `-OK` one shuts down with exit 4 saying
// the slice's session no longer exists, and the merge one accuses a person of
// not having the coordinator where it belongs. Both confidently and both
// falsely. That is why `listCmuxWorkspaces`'s `null` is translated here into
// `consultado: false` and not into "it is not there": this is the only place
// where that translation happens, and so it cannot diverge again.
//
// `undefined` is NEVER used for `ref`: "it was not looked at" travels in
// `consultado`, never camouflaged inside the handle.
// ---------------------------------------------------------------------------
export function findWorkspaceByTitle(title, opts = {}) {
  return primeraQueCase((w) => w.title === title, opts)
}

// Matches by DIRECTORY, and only against entries whose `cwdKnown` is true: an
// entry whose cwd schema we do not recognise can say neither that it matches
// nor that it does not. If NO entry exposes a directory, the result is not "it
// is not there": it is `consultado: false`, because the question could not be
// asked. Without this, a rename of that field would confidently return "cmux
// answered and it is not there" — the false negative D5 removed in ct-next and
// that was slipping in here through the back door.
export function findWorkspaceByCwd(cwd, opts = {}) {
  const all = listCmuxWorkspaces(opts)
  if (all === null) return { consultado: false, ref: null }
  const conocibles = all.filter((w) => w.cwdKnown)
  if (all.length > 0 && conocibles.length === 0) return { consultado: false, ref: null }
  const match = conocibles.find((w) => w.cwd === cwd && typeof w.ref === 'string')
  return { consultado: true, ref: match ? match.ref : null }
}

function primeraQueCase(predicado, opts) {
  const all = listCmuxWorkspaces(opts)
  if (all === null) return { consultado: false, ref: null }
  const match = all.find((w) => predicado(w) && typeof w.ref === 'string')
  return { consultado: true, ref: match ? match.ref : null }
}
