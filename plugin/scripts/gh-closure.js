// ============================================================================
// gh-closure.js — WHO CLOSED EACH ISSUE, AND WHICH BRANCH WAS REALLY MERGED.
//
// F18/H1. Until this round, the §9 contract (ct-init.sh) justified NOT checking
// how an issue was closed like this:
//
//   «cerrar a mano como *completed* sin haber mergeado nada SÍ satisface la
//    dep […] Eso no se detecta — haría falta cruzar el grafo de PRs (GraphQL,
//    UNA LLAMADA POR ISSUE CERRADO) para blindar un caso que requiere una
//    ACCIÓN ERRÓNEA DELIBERADA.»
//
// Both terms of that calculation were false, and both have been measured, not
// deduced:
//
//   (a) IT DOES NOT REQUIRE A DELIBERATE ACTION. A DOCUMENTATION commit whose
//       body contained the string `Closes #451` —inside a sentence that
//       explained precisely that the kickoff did NOT carry that keyword—
//       closed issue #451 of a production repo. GitHub parses closing keywords
//       in the commit messages that reach the default branch, and quotes do
//       NOT protect. Verified in the issue's own timeline: the `ClosedEvent`
//       has `closer.__typename = "Commit"`, oid c4b0da66, headline
//       «docs(loop): #37-#46 cerrados como completed…». Nobody meant to close
//       anything.
//
//   (b) IT DOES NOT COST ONE CALL PER ISSUE. A single GraphQL query with
//       aliases resolves N issues in one go. Measured against that same repo
//       on 28-jul-2026: 97 closed issues in ONE call, an 18.8 KB query, 2.8 s
//       of wall clock (10 issues: 0.87 s). The cost was an assumption.
//
// BUT the same measurement killed the obvious idea (using the closer as a GATE
// for `merge-after`), and this is what matters: of those 97 issues closed as
// *completed*, **86 have no closer at all** — a person closed them by hand.
// Only 11 were closed by a PR. Closing by hand is NOT the anomaly: it is the
// majority practice, and it is moreover a step PRESCRIBED by the contract
// itself (with `--base <another-branch>`, the `Closes #N` closes nothing and
// the contract orders closing by hand with
// `gh issue close --reason completed`). A gate on "closed by a merged PR"
// would have left 86 dependencies unsatisfied in one stroke in that repo: it
// would have bricked the whole epic for doing the right thing.
//
// WHAT CAN BE ASSERTED, and it is the only thing asserted here: an issue closed
// by a COMMIT that belongs to no merged PR is a closure NOBODY reviewed —
// nobody merged anything, there was no human gate, and it is enough for the
// string `Closes #N` to appear in any commit message that reaches the default
// branch. That is exactly the field case. Discriminator verified against real
// data: the accident's commit has `associatedPullRequests: []`, whereas a
// normal closure in the same repo (#54) carries
// `closer.__typename = "PullRequest", merged: true`.
//
// AND IT IS A WARNING, NEVER A GATE. It changes no dispatch decision: if the
// query fails, that is said and the run goes on. A detector that can be wrong
// cannot hold a veto over the work.
//
// This module looks at the EFFECT, after the commit is already on the default
// branch: there is no way to prevent it from here, only to name it. There is
// also a gate (`hooks/commit-keyword-guard.js`) that attacks the CAUSE, denying
// the `git commit` before the keyword ever gets to exist in the history — but
// it only sees what goes through a `git commit -m` of a Claude session. What
// escapes that gate (a commit typed outside Claude, one without `-m`, a
// `-F <file>`, an `--amend --no-edit`) still has no net other than this
// warning. Neither of the two claims to catch everything.
//
// F18/H4 travels in the SAME call, at ZERO marginal network cost: a slice's
// branch is deterministic (`feat/<n>`), so one more alias per issue in
// `status:in-review` turns the either-or the dispatcher says today («o el PR se
// mergeó y nadie cerró el issue, o…») into a checked fact. Mind the direction:
// this check CONFIRMS, it does not refute — the absence of a merged PR with
// head `feat/<n>` does not prove the work was not merged (it may have gone out
// on a branch with another name), so silence is not reported as "it was not
// merged".
// ============================================================================

// The cap of issues per query. The real measurement (97 aliases, 18.8 KB,
// 2.8 s) says 60 is plenty; the cap exists so that a repo with hundreds of
// slices does not build an outsized query on the dispatcher's critical path.
// What is left out is SAID (see formatClosureCoverageNote): it is never
// trimmed in silence.
export const CLOSURE_PROBE_MAX = 60

// Alias prefixes. GraphQL does not accept aliases starting with a digit.
const DEP_ALIAS = 'dep'
const REVIEW_ALIAS = 'rev'

/**
 * planClosureProbe: decides WHAT to ask, out of what is already known without
 * a network. Two sets, neither of them "every closed issue":
 *
 *   - `deps`: closed issues that RIGHT NOW are satisfying a `merge-after` of
 *     some open issue. Asking about a closed issue nothing hangs off would not
 *     change anybody's decision.
 *   - `inReview`: open issues in `status:in-review`, for the "merged PR, open
 *     issue" backstop (H4).
 *
 * `dependents` keeps who depends on each dep: without that, the warning would
 * say "watch out for #451" without saying whom it affects, which is the half
 * that matters.
 */
export function planClosureProbe({ issues, mergedIssues } = {}) {
  const merged = new Set(mergedIssues || [])
  const dependents = new Map()
  for (const i of issues || []) {
    for (const d of i.deps || []) {
      if (d == null || !merged.has(d)) continue
      if (!dependents.has(d)) dependents.set(d, [])
      if (!dependents.get(d).includes(i.n)) dependents.get(d).push(i.n)
    }
  }
  const deps = [...dependents.keys()].sort((a, b) => a - b)
  const inReview = (issues || []).filter((i) => i.status === 'in-review').map((i) => i.n).sort((a, b) => a - b)
  return { deps, inReview, dependents }
}

/**
 * buildClosureQuery: the query, or `null` if there is nothing to ask (a repo
 * with no satisfied deps and nothing under review) — in that case NO call is
 * made at all.
 *
 * `owner`/`name` are interpolated between quotes: `parseRepoSlug`
 * (dispatch.js) has already rejected any slug that is not `owner/repo` with
 * both halves non-empty before reaching here, and that format admits neither
 * quotes nor backslashes. They are escaped all the same, because a GraphQL
 * query broken by a quote is a silent network failure and not a usage error.
 */
export function buildClosureQuery(repo, plan, limit = CLOSURE_PROBE_MAX) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name) return null
  const deps = (plan?.deps || []).slice(0, limit)
  const inReview = (plan?.inReview || []).slice(0, limit)
  if (!deps.length && !inReview.length) return null
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const depFields = deps.map((n) => `${DEP_ALIAS}${n}: issue(number:${n}) { number timelineItems(last:1, itemTypes:[CLOSED_EVENT]) { nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number merged } ... on Commit { oid messageHeadline associatedPullRequests(first:2) { nodes { number merged } } } } } } } }`)
  const revFields = inReview.map((n) => `${REVIEW_ALIAS}${n}: pullRequests(headRefName:"feat/${n}", states:[MERGED], first:1) { nodes { number mergedAt } }`)
  return `{ repository(owner:"${q(owner)}", name:"${q(name)}") { ${[...depFields, ...revFields].join(' ')} } }`
}

/**
 * parseClosureProbe: the answer → two maps, inventing nothing.
 *
 *   closers[n] = { kind, ... } with kind ∈
 *     'pull-request' (+ pr, merged) | 'commit' (+ oid, headline, prs[])
 *     | 'manual'  (there was a ClosedEvent but no closer: a person closed it)
 *     | 'unknown' (the alias did not come, or came with no ClosedEvent:
 *                  NOTHING is asserted)
 *   mergedPr[n] = { number, mergedAt }  — only if there really is one.
 *
 * An absent alias is 'unknown' and NOT 'manual': the difference is the whole
 * difference between "it is on record that a person closed it" and "we do not
 * know".
 */
export function parseClosureProbe(raw, plan) {
  const repoData = raw?.data?.repository ?? null
  const closers = {}
  const mergedPr = {}
  for (const n of plan?.deps || []) {
    const node = repoData ? repoData[`${DEP_ALIAS}${n}`] : undefined
    if (!node) { closers[n] = { kind: 'unknown' }; continue }
    const ev = (node.timelineItems?.nodes || []).filter(Boolean).pop()
    if (!ev) { closers[n] = { kind: 'unknown' }; continue }
    const c = ev.closer
    if (!c) { closers[n] = { kind: 'manual' }; continue }
    if (c.__typename === 'PullRequest') {
      closers[n] = { kind: 'pull-request', pr: c.number ?? null, merged: c.merged === true }
    } else if (c.__typename === 'Commit') {
      const prs = (c.associatedPullRequests?.nodes || []).filter(Boolean)
      closers[n] = {
        kind: 'commit',
        oid: typeof c.oid === 'string' ? c.oid : '',
        headline: typeof c.messageHeadline === 'string' ? c.messageHeadline : '',
        mergedPrs: prs.filter((p) => p.merged === true).map((p) => p.number),
      }
    } else {
      closers[n] = { kind: 'unknown' }
    }
  }
  for (const n of plan?.inReview || []) {
    const node = repoData ? repoData[`${REVIEW_ALIAS}${n}`] : undefined
    const pr = (node?.nodes || []).filter(Boolean)[0]
    if (pr && Number.isInteger(pr.number)) mergedPr[n] = { number: pr.number, mergedAt: pr.mergedAt ?? null }
  }
  return { closers, mergedPr }
}

const shortOid = (oid) => (typeof oid === 'string' ? oid.slice(0, 8) : '')

/**
 * formatSuspectClosureWarnings: ONLY the closures nobody reviewed.
 *
 * What does NOT come out of here, and why:
 *   - `manual` (86 out of 97 in the measured repo): closing by hand is the
 *     majority practice AND a step prescribed by the contract when the base is
 *     not the default branch. Warning about that would be warning about the
 *     normal case, and a warning that comes out 86 times is read by nobody;
 *   - `pull-request` with `merged: true`: the happy path;
 *   - `unknown`: what has not been seen is not asserted. Incomplete coverage is
 *     said separately (formatClosureCoverageNote), not as suspicion.
 */
export function formatSuspectClosureWarnings(closers, dependents) {
  const out = []
  for (const [key, c] of Object.entries(closers || {})) {
    const n = Number(key)
    const deps = (dependents instanceof Map ? dependents.get(n) : (dependents || {})[n]) || []
    const quien = deps.length ? `${deps.map((d) => `#${d}`).join(', ')}` : 'algún slice'
    if (c.kind === 'commit' && c.mergedPrs.length === 0) {
      out.push(`#${n} consta cerrado como *completed* por el COMMIT ${shortOid(c.oid)}${c.headline ? ` («${c.headline}»)` : ''}, que no pertenece a ningún PR mergeado — nadie revisó ni mergeó nada para cerrarlo. GitHub cierra un issue con una closing keyword en CUALQUIER mensaje de commit que llegue a la rama por defecto, incluido un commit que solo la MENCIONA (las comillas no protegen; ocurrió así en un repo real con un commit de documentación). Y ${quien} depende de #${n} con "merge-after": esa dependencia se está dando por satisfecha sobre un trabajo que puede no existir. Comprueba #${n} ANTES de despachar a quien depende de él; si el trabajo no está, reabre #${n} (\`gh issue reopen ${n}\`).`)
    } else if (c.kind === 'pull-request' && c.merged === false) {
      out.push(`#${n} consta cerrado como *completed* por el PR #${c.pr}, pero ese PR NO está mergeado — la dependencia de ${quien} se da por satisfecha sobre trabajo que no ha entrado en ninguna rama. Comprueba #${n} antes de despachar a quien depende de él.`)
    }
  }
  return out
}

/**
 * formatMergedButOpenWarnings (H4): the either-or turned into a fact.
 *
 * ct-next.mjs's blocking messages say «mergea su PR — o, si el PR ya se mergeó
 * y el issue sigue abierto, ciérralo». Which of the two was true is something
 * the human had to find out by looking at GitHub. When the deterministic branch
 * `feat/<n>` DOES have a merged PR, here it is said which one and since when.
 */
export function formatMergedButOpenWarnings(mergedPr, repo) {
  return Object.entries(mergedPr || {}).map(([key, pr]) => {
    const n = Number(key)
    const cuando = pr.mergedAt ? ` (mergeado el ${String(pr.mergedAt).slice(0, 10)})` : ''
    return `#${n} sigue en status:in-review, pero su rama feat/${n} YA está mergeada en el PR #${pr.number}${cuando}: su trabajo está en la base y el issue se quedó abierto —el \`Closes #${n}\` no llegó a aplicarse (o el PR se mergeó en una rama que no es la por defecto)—. Mientras siga abierto retiene sus tokens de área/touches y ningún "merge-after" sobre él cuenta como satisfecho. Ciérralo: \`gh issue close ${n} --repo ${repo} --reason completed\`.`
  })
}

/**
 * formatClosureCoverageNote: if the cap trimmed the query, what was left
 * UNLOOKED-AT is said. A detector that keeps quiet about its own coverage reads
 * as "everything checked, nothing to report", which is exactly the lie this
 * round is after.
 */
export function formatClosureCoverageNote(plan, limit = CLOSURE_PROBE_MAX) {
  const fuera = Math.max(0, (plan?.deps || []).length - limit) + Math.max(0, (plan?.inReview || []).length - limit)
  if (fuera === 0) return null
  return `la comprobación de cómo se cerró cada dependencia (y de si la rama de un slice en revisión ya está mergeada) se ha limitado a ${limit} issues por consulta: ${fuera} han quedado SIN mirar en esta corrida. No es "están bien": es "no se han comprobado".`
}
