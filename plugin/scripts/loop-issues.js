// loadIssues: the paginated read of open and closed issues, extracted out
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
// report came out empty under a footer that closed with «what is above is
// only what it did manage to check»… and above it there was nothing. It
// contradicts the contract that command publishes in its own header and in
// commands/ct-status.md: what IS known is reported. So both reads are ALWAYS
// ATTEMPTED and whatever came out right is returned together with the reasons
// for whatever did not:
//
//   { abiertos, cerrados, motivos }   motivos: [] ⇔ both reads went fine
//
// Every reason names WHICH of the two reads failed. A caller that wants to
// abort on any failure looks at `motivos.length` (that is what /ct-next does);
// one that wants to report the partial picture uses the arrays all the same.
//
// The listing goes over GraphQL (issuesQueryFor, scripts/gh-issues.js) and
// NEVER over the REST `repos/<repo>/issues` (#46): that endpoint shares its
// namespace with pull requests and shipped every PR of the repository with its
// whole body, which in a repository the size of mo.picking.api overflowed
// execFileSync's buffer (ENOBUFS) before a single issue was read. Nor the
// search index (`--search`/`gh search issues`): that one has indexing latency
// and might not reflect a label another runner has just written. Nor a fixed
// `--limit`: newest first, so a cap leaves out precisely the OLD issues, which
// are the ones that tend to have dependents.
import { issuesQueryFor, normalizeGraphqlIssues } from './gh-issues.js'

const OPEN_ISSUES_QUERY = issuesQueryFor(['OPEN'])
const CLOSED_ISSUES_QUERY = issuesQueryFor(['CLOSED'])

function listIssues({ repo, gh, query }) {
  const [owner, name] = repo.split('/')
  return normalizeGraphqlIssues(JSON.parse(
    gh(['api', 'graphql', '--paginate', '--slurp', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`])))
}

export function loadIssues({ repo, gh }) {
  // A failed read leaves its array EMPTY and its reason in the list. Never the
  // other way round: an empty array with no reason would mean "there are no
  // issues", which is the class of silent degradation this whole module
  // avoids.
  const reasons = []
  // open issues with labels → {n, order, status, deps, touches, name, type, ac, issue}.
  // The mapping itself (mapGhIssue/filterMergedIssues) is pure logic extracted
  // to gh-issue-map.js — see __tests__/gh-issue-map.test.js — so that it can be
  // tested without a network and so that a format drift against groom.js is
  // caught.
  let open = []
  try {
    open = listIssues({ repo, gh, query: OPEN_ISSUES_QUERY })
  } catch (e) {
    reasons.push(`could not list open issues of ${repo}: ${e.message}`)
  }

  let closed = []
  try {
    // `body` is indispensable here (not just number,stateReason): it is the
    // only way to recover the <!-- ct-order:N --> marker of an ALREADY CLOSED
    // issue, and without that marker buildDispatchInput cannot translate a dep
    // in order space into the real issue number of a dependency that has
    // already been merged (see gh-issue-map.js#buildOrderIndex).
    //
    // `stateReason` arrives as GitHub's enum (upper case: "COMPLETED"), which is
    // exactly what filterMergedIssues expects; the REST `state_reason` in lower
    // case that this wrapper used to normalise no longer enters.
    closed = listIssues({ repo, gh, query: CLOSED_ISSUES_QUERY }).map((i) => ({
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
      // labels (F18/H2): the labels of a CLOSED issue reveal the contradictory
      // state "closed + a live `status:`" — the issue that fell out of the
      // dispatch queue without anyone saying so. They travel in this VERY SAME
      // response: keeping them does not cost one extra call.
      labels: i.labels || [],
      stateReason: i.stateReason ?? null,
    }))
  } catch (e) {
    reasons.push(`could not list closed issues of ${repo}: ${e.message}`)
  }

  return { abiertos: open, cerrados: closed, motivos: reasons }
}
