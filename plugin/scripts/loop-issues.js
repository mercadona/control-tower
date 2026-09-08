// cargarIssues: the paginated read of open and closed issues, extracted out
// of loadIssues (ct-next.mjs) so that a shared module does not end up
// paginating differently depending on who calls it — that drift is the class
// of bug this module exists to kill.
//
// A shared module does not decide for its caller: /ct-next wants to abort on
// a failed read, and another command may want to report what it does know and
// carry on. That is why this function does not exit the process — the
// decision of what to do with the failure belongs to each caller.
//
// And that is why it does not THROW either, which is how it was and was
// worse: throwing when the read of closed issues failed THREW AWAY the read
// of open ones, which was already whole in memory. Reproduced: the /ct-status
// report came out empty under a footer that closed with «lo de arriba es sólo
// lo que sí se ha podido comprobar»… and above it there was nothing. (Back
// then the footer counted «2 lectura(s) sin completar»; today it counts
// warnings, which is the exact thing — see ct-status.mjs.) It contradicts the
// contract that command
// publishes in its own header and in commands/ct-status.md: «se informa de lo
// que sí se sabe». So both reads are ALWAYS ATTEMPTED and whatever came out
// right is returned together with the reasons for whatever did not:
//
//   { abiertos, cerrados, motivos }   motivos: [] ⇔ both reads went fine
//
// Every reason names WHICH of the two reads failed, just as the Error did. A
// caller that wants to abort on any failure looks at `motivos.length` (that is
// what /ct-next does, and its behaviour does not change); one that wants to
// report the partial picture uses the arrays all the same.
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

export function cargarIssues({ repo, gh }) {
  // A failed read leaves its array EMPTY and its reason in the list. Never the
  // other way round: an empty array with no reason would mean "there are no
  // issues", which is the class of silent degradation this whole module
  // avoids.
  const motivos = []
  // open issues with labels → {n, order, status, deps, touches, name, type, ac, issue}.
  // Enumerated through the REST endpoint `gh api repos/<repo>/issues`, NEVER
  // the search index (`--search`/`gh search issues`): that one has indexing
  // latency and might not reflect a label another runner has just written.
  // Nor `gh issue list --limit N` with a fixed cap (finding 2 of the final
  // review): that endpoint returns newest first, so a fixed `--limit` leaves
  // out precisely the OLD issues — which are the ones that tend to have
  // dependents. Two silent consequences observed: a merged dependency that
  // falls outside `mergedIssues` leaves a slice permanently undispatchable,
  // and (in dispatch-check.mjs) a colliding `in-progress` that falls outside
  // `allOpen()` makes the lock fail open. Instead we use real pagination
  // (`--paginate --slurp`, with no cap) just as ct-groom.mjs does, and we
  // reuse its very same helper for flattening/filtering PRs
  // (scripts/gh-issues.js) — that endpoint also returns pull requests (they
  // share a namespace in the v3 API). The mapping itself
  // (mapGhIssue/filterMergedIssues) is pure logic extracted to
  // gh-issue-map.js — see __tests__/gh-issue-map.test.js — so that it can be
  // tested without a network and so that a format drift against groom.js is
  // caught.
  let abiertos = []
  try {
    // per_page=100 (re-review): the REST default is 30/page — with --paginate
    // they all get fetched anyway, but at 3x more round-trips than needed. 100
    // is the maximum this endpoint admits.
    abiertos = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  } catch (e) {
    motivos.push(`no se pudieron listar issues abiertos de ${repo}: ${e.message}`)
  }

  let cerrados = []
  try {
    // `body` is indispensable here (not just number,stateReason): it is the
    // only way to recover the <!-- ct-order:N --> marker of an ALREADY CLOSED
    // issue, and without that marker buildDispatchInput cannot translate a dep
    // in order space into the real issue number of a dependency that has
    // already been merged (see gh-issue-map.js#buildOrderIndex).
    //
    // The state field of the REST endpoint is `state_reason`, in lower case
    // (e.g. "completed") — DIFFERENT from the `stateReason` that `gh issue
    // list --json stateReason` exposes through GraphQL, in upper case
    // ("COMPLETED"), which is what filterMergedIssues expects (see
    // gh-issue-map.js, verified against gh 2.86). We normalise here, in the
    // wrapper, so as not to have to teach the pure layer two formats of the
    // same thing.
    const rawCerrados = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=closed', '-f', 'per_page=100', '--paginate', '--slurp']))))
    cerrados = rawCerrados.map((i) => ({
      number: i.number,
      body: i.body,
      // milestone (D1 finding 1): buildOrderIndex needs the milestone of ANY
      // issue, open or closed, to be able to scan the order PER EPIC instead
      // of globally across the repo — without this, every closed issue would
      // fall into the shared bucket NO_MILESTONE_KEY regardless of its real
      // epic, risking a FALSE collision between two different epics that
      // genuinely do have different milestones (one simply did not travel
      // this far).
      milestone: i.milestone || null,
      // labels (F18/H2): the labels of a CLOSED issue were used for nothing
      // and were thrown away here. They are the ones that reveal the
      // contradictory state "closed + a live `status:`" — the issue that fell
      // out of the dispatch queue without anyone saying so. They travel in
      // this VERY SAME REST response: keeping them does not cost one extra
      // call.
      labels: i.labels || [],
      stateReason: i.state_reason ? String(i.state_reason).toUpperCase() : null,
    }))
  } catch (e) {
    motivos.push(`no se pudieron listar issues cerrados de ${repo}: ${e.message}`)
  }

  return { abiertos, cerrados, motivos }
}
