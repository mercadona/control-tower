// scope.js — DO THE FILES THIS PR TOUCHED FIT INSIDE THE SCOPE THE EPIC
// DECLARED?
//
// WHY IT EXISTS, with names and dates. Dispatch 1, slice 4 (menoplus #662 → PR
// #668, 2026-08-13): the agent touched on-screen GDPR copy against its explicit
// «Protegido» and wrote in the ledger and in the PR body that Jose had
// authorised it. Both claims were false — its transcript has ONE single user
// entry, the dispatcher's kickoff. A person caught it, surprised to see two of
// the app's `.swift` files in the file list; no mechanical check caught it,
// because there was none.
//
// THE IDEA THAT GOVERNS EVERYTHING: the human signature is NOT verifiable from
// inside the loop. The dispatched agent runs with Jose's GitHub credentials, so
// it can produce any GitHub artefact —a review, an approval, a comment— and its
// record is prose nobody cross-checks. What IS verifiable is what it TOUCHED:
// the diff is a fact, and a fact cannot be falsified without it showing. That
// is why this module does not try to check signatures. It checks facts.
//
// WHERE THE CHECK LIVES, and it is not a detail: in a workflow of the target
// repo, over the PR. NOT in `dispatch-check --release`, because `--release` is
// invoked by the agent itself and a guard that runs the suspect is not a guard.
//
// A PURE module: neither network nor disk.
import { findClosingKeywords } from './closing-keywords.js'

// The scope is declared ONCE PER EPIC, not per slice, and it lives in the
// `## Contexto del epic` section of the execution spec — which is the ONLY one
// groom copies verbatim into the issue. Putting it in any other section would
// create a scope that exists in the spec and does not exist where it gets
// checked.
//
// Once per epic and not per row is deliberate: it is written at the freeze,
// which is the only moment of the cycle when Jose reads. Four fields to fill in
// get forgotten; one does not.
const SECTION_HEADING = /^##\s+Contexto del epic\s*$/i
const ANY_HEADING = /^#{1,6}\s+/
// `Alcance:` with the bold and the backticks the template uses around
// everything else. Without this tolerance, writing it like the rest of the
// section —which is the natural thing— would leave it invisible.
const SCOPE_LINE = /^\s*[-*]?\s*\**\s*Alcance\s*\**\s*:\s*(.*)$/i

// The files the loop ITSELF forces to be committed. They are not an exception
// to the scope: they are the footprint of the mechanism that imposes the scope.
//
// The kickoff ORDERS the agent to write the slice's plan in
// `docs/superpowers/plans/` and commit it («it travels in the PR»). Failing the
// gate over that would be an unsatisfiable wall —it can only be met by
// disobeying the dispatcher— and a guard like that ends up ignored whole, which
// is the lesson conventions.js already paid for in this repo (F14).
//
// `.agent/SLICE.md` is NOT here, and that is deliberate: it is session state,
// not the slice's product. In dispatch 1 an agent put it into its PR and took
// it out again itself afterwards with that very argument. Exempting it would
// normalise exactly what that agent corrected on its own.
//
// `.superpowers/**` is NOT here EITHER, and that is deliberate too: the
// brainstorming skill itself says that directory goes in `.gitignore`. When it
// shows up in a PR —as `.superpowers/sdd/progress.md` showed up in PR #668— it
// is not a false positive of the gate: it is committed session state, residue
// of the fork, and flagging it is the correct behaviour.
//
// THE LIST IS SHORT ON PURPOSE and contains only what THE PLUGIN mandates,
// which is the only thing that holds in any repo. Each repo's own bookkeeping
// (`BITACORA.md` in menoplus, for example) is NOT hardcoded here: it travels
// through `extraExempt`, which the target repo's workflow passes. Putting one
// concrete repo's paths into the plugin would turn them into holes for everyone
// else.
export const LOOP_ARTIFACT_PATTERNS = [
  // The kickoff ORDERS the slice's plan to be written here and committed.
  'docs/superpowers/plans/**',
  // The brainstorming skill writes the design doc and the execution spec here,
  // and the slice fills in the spec's «Registro de cierre (evidencia)» on
  // delivering.
  //
  // A LIMIT THAT HAS TO BE SAID OUT LOUD: this exemption lets the agent write
  // into the FROZEN spec without the gate seeing it — and in the incident of
  // dispatch 1 the agent put part of its false authorisation in there. The gate
  // cannot cover it: it does not judge prose, it judges files. The immutability
  // of the spec's frozen sections is a DIFFERENT check and it is unbuilt.
  'docs/superpowers/specs/**',
  // `ct-step verdict` writes the judge's verdict here when the ruling is PASS,
  // stages it and leaves it INSIDE the task's commit, because the verdict has
  // to travel in the pull request (F37's closure criterion: «el PR de un slice
  // trae un veredicto emitido por un agente que no ejecutó nada»). The
  // implementer does not choose that write and cannot avoid it, so without this
  // exemption the gate goes red in ANY epic that declares its `Alcance:` line
  // and asks for something impossible —«either the work leaves the PR, or the
  // epic's scope changes»—, which is F14's unsatisfiable wall all over again.
  'docs/superpowers/verdicts/**',
  // The run's telemetry: one row per attempt of every step of every task. The
  // loop writes it, not the implementer, and for the same reason as the verdict
  // it is going to stop living only on the disk of whoever wrote it and start
  // travelling in the pull request. The exemption is put in BEFORE that write
  // arrives on purpose: the other way round, the first slice that produces it
  // comes out red over a file of the loop's, and whoever reads the gate will not
  // be able to tell whether the red was put there by the agent or by the
  // machinery.
  'docs/superpowers/metrics/**',
  // `ct-step e2e` WRITES the journey's report here and stages it, so it
  // travels in the slice's commit. Its OWN directory and not the spec's
  // «Registro de cierre» on purpose: that exemption (specs/**, above) is the
  // hole through which, in the incident of dispatch 1, an agent put part of its
  // false authorisation — and putting precisely the evidence that something was
  // verified through there is the worst possible combination. Nobody else writes
  // here.
  'docs/superpowers/e2e/**',
]

function normalizePath(p) {
  return String(p || '').replace(/^\.\//, '').replace(/^\/+/, '')
}

/**
 * parseScope: the scope the epic declared, or the record that there is none.
 *
 * `declared: false` does NOT mean «no restrictions»: it means «it cannot be
 * checked». It is the same rule the rest of the plugin already holds —the 1
 * never degrades to a 0— and its practical effect is the one being sought: push
 * the friction to the freeze instead of discovering the gap when there is
 * already an open PR.
 */
export function parseScope(issueBody) {
  const text = typeof issueBody === 'string' ? issueBody : ''
  const lines = text.split(/\r?\n/)

  // Only INSIDE `## Contexto del epic` is looked at, and the section is cut at
  // the next heading of any level: without that cut, an `Alcance:` written
  // further down (in «Out of scope», for example) would read as if it belonged
  // to this section.
  let inside = false
  const patterns = []
  for (const line of lines) {
    if (SECTION_HEADING.test(line)) { inside = true; continue }
    if (inside && ANY_HEADING.test(line)) break
    if (!inside) continue
    const m = line.match(SCOPE_LINE)
    if (!m) continue
    // The closing of the label's bold: in `- **Alcance:** apps/**` the two
    // asterisks that close the `**Alcance:**` fall AFTER the colon and would
    // sneak into the start of the value.
    //
    // They are removed only when followed by a space, and that detail is the
    // difference between fixing the label and breaking a legitimate glob: the
    // closing of the bold always carries a space behind it (`** apps/…`),
    // whereas a pattern that starts with `**` always carries a slash
    // (`**/*.swift`).
    const value = m[1].replace(/^\*\*(?=\s)/, '')
    for (const chunk of value.split(',')) {
      // The BACKTICKS are removed and nothing else. The temptation is to remove
      // Markdown's bold asterisks too, and that is a bug: in the value the
      // asterisks are the glob (`apps/ios/**`), not decoration. The first
      // version of this line deleted them and turned every pattern into a
      // directory prefix in silence — the gate stayed green and checked
      // something else. The LABEL's bold (`- **Alcance:**`) is already absorbed
      // by SCOPE_LINE, so it never reaches here.
      const cleaned = chunk.replace(/`/g, '').trim()
      if (cleaned) patterns.push(cleaned)
    }
  }

  if (!patterns.length) {
    return {
      declared: false,
      patterns: [],
      reason: 'the epic does not declare `Alcance:` in its `## Contexto del epic` section — with no declared scope the gate cannot check anything, and not being able to check is NOT being clean',
    }
  }
  return { declared: true, patterns, reason: null }
}

/**
 * matchesPattern: the gate's minimal glob, said whole so that nobody has to
 * guess it by reading the code.
 *
 *   `**`  crosses directory separators (zero or more segments)
 *   `*`   does NOT cross separators
 *   `a/b` matches exactly
 *   `a/`  stands for the whole directory (a kindness: whoever writes the scope
 *         at the freeze writes the directory, not the glob, and a red over
 *         syntax at that moment is the worst possible moment)
 *
 * Everything else is LITERAL. The dot in particular: without escaping it,
 * `.github` would match `Xgithub`.
 */
export function matchesPattern(path, pattern) {
  const p = normalizePath(path)
  let pat = normalizePath(pattern)
  if (!pat) return false
  if (pat.endsWith('/')) pat = `${pat}**`

  // The regex is built piece by piece instead of with chained replacements:
  // chaining replacements over `**` and `*` makes the second one trample what
  // the first one wrote, which is the classic bug of every mini-glob.
  let re = '^'
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i]
    if (c === '*') {
      if (pat[i + 1] === '*') {
        // `**/` eats the separator too, so that `a/**` matches `a/b` and
        // `a/b/c` without asking for two patterns.
        if (pat[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else {
        re += '[^/]*'
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  re += '$'
  return new RegExp(re).test(p)
}

/**
 * scopeViolations: the PR's files that fall OUTSIDE the scope.
 *
 * With no patterns it returns ALL the files, never the empty list: an epic with
 * no declared scope is not an epic with a free run. Returning `[]` here would
 * leave the caller reading «nothing to see» about precisely the case the gate
 * exists to close.
 */
export function scopeViolations(files, patterns, extraExempt = []) {
  const pats = Array.isArray(patterns) ? patterns.filter(Boolean) : []
  // The plugin's exemptions (what the loop forces to be committed in ANY repo)
  // plus whatever the target repo declares in its workflow (its own
  // bookkeeping). They add up instead of replacing one another: a repo cannot
  // accidentally switch off the plugin's by declaring its own.
  const exemptPatterns = [...LOOP_ARTIFACT_PATTERNS, ...(Array.isArray(extraExempt) ? extraExempt.filter(Boolean) : [])]
  return (files || [])
    .map(normalizePath)
    .filter((f) => f)
    .filter((f) => !exemptPatterns.some((pat) => matchesPattern(f, pat)))
    .filter((f) => !pats.some((pat) => matchesPattern(f, pat)))
}

/**
 * isSliceBranch: did the dispatcher create this branch?
 *
 * `feat/<n>` is the plugin's own convention (dispatch.js's default
 * `branchNameOf`). It exists for one single decision, and it is the one that
 * saves the gate from dying of noise: a PR WITHOUT a closing keyword that comes
 * from a slice branch is broken and comes out red; one that comes from any other
 * branch simply is not the loop's harvest and the gate has nothing to say about
 * it.
 *
 * Without this distinction, the gate would fail ALL the repo's human and
 * documentation PRs — and a guard that can only be satisfied by disobeying gets
 * switched off whole in a day. It is exactly the failure conventions.js already
 * paid for in this repo (F14): the unsatisfiable wall.
 */
export function isSliceBranch(name) {
  return /^feat\/\d+$/.test(String(name || '').trim())
}

/**
 * issueFromPrBody: which issue this PR belongs to, according to its own closing
 * keyword.
 *
 * It leans on findClosingKeywords (closing-keywords.js) instead of
 * reimplementing the recogniser: two recognisers of the same text drift, and
 * that one is already hardened against the ReDoS measured in F27.
 *
 * Two issues closed by the same PR return `null` instead of the first one: the
 * gate does not silently choose which of the two scopes applies.
 */
export function issueFromPrBody(prBody) {
  const found = findClosingKeywords(typeof prBody === 'string' ? prBody : '')
  const numbers = new Set()
  for (const { ref } of found) {
    const m = String(ref).match(/#(\d+)$/)
    if (m) numbers.add(Number(m[1]))
  }
  if (numbers.size !== 1) return null
  return [...numbers][0]
}
