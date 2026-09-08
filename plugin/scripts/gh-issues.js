// Pure logic for parsing/filtering the paginated issue listing of
// `gh api repos/<o>/<r>/issues --paginate --slurp` and for finding the
// ct-order marker. Extracted out of ct-groom.mjs so that it can be tested
// without a network:
//
// 1. That REST issues endpoint ALSO returns the repo's pull requests (they
//    share a namespace in API v3). The entries carrying the `pull_request`
//    key have to be discarded before looking for the marker, or it can match
//    against a PR's body.
// 2. `gh api --paginate` without `--slurp` prints each page as a separate
//    JSON document (several JSON arrays concatenated on stdout), which breaks
//    a direct `JSON.parse` as soon as there is more than one page. With
//    `--slurp`, gh wraps all the pages in an outer array — the result is an
//    array of arrays (one per page) that has to be flattened.

// flattenPages: flattens the array-of-pages that `--paginate --slurp`
// produces. There is nothing issue-specific about it (F6 reuses it for the
// repo's label listing, which paginates the same way); `flattenIssuePages` is
// kept as the name ct-groom.mjs/ct-next.mjs and their tests already call it
// by.
export function flattenPages(parsed) {
  if (!Array.isArray(parsed)) return []
  return parsed.flat()
}
export function flattenIssuePages(parsed) {
  return flattenPages(parsed)
}

export function isPullRequest(entry) {
  return Object.prototype.hasOwnProperty.call(entry || {}, 'pull_request')
}

export function realIssuesOnly(entries) {
  return (entries || []).filter((e) => !isPullRequest(e))
}

// GROOM_ISSUES_QUERY: the repo's issue listing that /ct-groom needs in order
// to be idempotent and safe to re-run (idempotence via the ct-order marker,
// orphans, and Gates A/B of the per-epic scope). It is asked for over GraphQL
// instead of the REST `repos/<o>/<r>/issues` for a PAYLOAD reason, not a
// behavioural one:
//   1. GraphQL's `issues` connection returns ONLY issues, NEVER pull requests
//      — REST v3 shares a namespace and brought in every PR of the repo, which
//      `realIssuesOnly` threw away after downloading them (in a repo with
//      thousands of PRs, that dead weight overflowed execFileSync's buffer →
//      ENOBUFS and the groom died before creating anything).
//   2. ONLY the fields the code uses are asked for (number/title/body/state/
//      milestone/labels), not the whole REST object (reactions, user,
//      assignees…).
// The resulting set of issues is IDENTICAL to the one REST produced after
// `realIssuesOnly`: same behaviour, a fraction of the bytes.
//
// `$endCursor` + `pageInfo` are what `gh api graphql --paginate` uses to follow
// cursor pagination on its own. `states:[OPEN,CLOSED]` = the `state=all` of
// before.
//
// `$endCursor` is DECLARED FIRST (review of #45): GraphQL variables are passed
// by name, not by position, so in theory it makes no difference — but it is the
// shape of `gh`'s canonical example and it removes any doubt. What is NOT
// optional: the variable has to be called exactly `endCursor` and `pageInfo`
// has to be present, or `gh api graphql --paginate` silently returns ONLY the
// first page. The net that catches this is the fake-gh multi-page test.
export const GROOM_ISSUES_QUERY = `query($endCursor:String,$owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    issues(first:100,after:$endCursor,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){
      nodes{ number title body state milestone{title} labels(first:50){nodes{name}} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// normalizeGraphqlIssues: flattens the pages of `gh api graphql --paginate
// --slurp` (an array of response objects, one per page) and returns the issues
// in the SAME shape the rest of the pipeline already expects from REST: `state`
// lowercased ('open'/'closed', as diffIssue used to compare it), `labels`
// flattened to `[{name}]`, `milestone` as `{title}` or null. It invents no
// fields: it only translates.
export function normalizeGraphqlIssues(pages) {
  if (!Array.isArray(pages)) return []
  const out = []
  for (const page of pages) {
    const nodes = page?.data?.repository?.issues?.nodes
    if (!Array.isArray(nodes)) continue
    for (const n of nodes) {
      out.push({
        number: n.number,
        title: n.title,
        body: n.body,
        state: typeof n.state === 'string' ? n.state.toLowerCase() : n.state,
        milestone: n.milestone ? { title: n.milestone.title } : null,
        labels: (n.labels?.nodes || []).map((l) => ({ name: l.name })),
      })
    }
  }
  return out
}

export function findByMarker(issues, marker) {
  return (issues || []).find((i) => (i.body || '').includes(marker))
}

// F23 — /ct-groom's per-epic scope. The counterpart of epicKeyOf/
// buildOrderIndex (scripts/gh-issue-map.js), which solve the same thing for
// /ct-next, but with ANOTHER key and for a concrete reason: /ct-next indexes by
// `milestone.number`, and /ct-groom cannot, because it enumerates the repo's
// issues BEFORE having resolved (or created) the run's milestone — that order
// is deliberate, not accidental: the listing was placed ahead of the
// milestone's creation precisely so that a validation abort would not leave a
// milestone and a set of labels already created on GitHub (see ct-groom.mjs's
// long comment about the order of the reads). At that point the only thing
// known about the epic is its TITLE, which is the `--milestone` argument; and
// the title is already the key with which the script itself makes the
// milestone's creation idempotent, so no new notion of identity is introduced.
//
// An issue WITHOUT a milestone is attributed to nobody: it falls into
// `sinMilestone`, its own bucket. Same criterion as NO_MILESTONE_KEY — shared
// and with a warning, never invisible. Who decides what to do with that bucket
// is the caller (ct-groom.mjs), not this function: here it only gets sorted.
export function epicTitleOf(rawIssue) {
  const title = rawIssue?.milestone?.title
  return (typeof title === 'string' && title.length > 0) ? title : null
}

// partitionByEpic: three DISJOINT buckets that always add up to the whole
// input — no call can lose an issue on the way, which is exactly the failure
// mode that would produce duplicates (an issue that exists but the groom does
// not see gets created again). The input order is preserved inside each bucket
// so that the messages to the human come out in the order GitHub returned them,
// not in an arbitrary one.
//
// The title is compared EXACTLY, without normalising case or whitespace: it is
// the same comparison the milestone resolution further down in ct-groom.mjs
// makes (`allMilestones.find((m) => m.title === milestone)`). Loosening the
// comparison here and not there would make this sorting believe it is looking
// at an epic that the milestone's creation would consider a different one — and
// that discrepancy is exactly what produces duplicates.
export function partitionByEpic(issues, milestoneTitle) {
  const inEpic = []
  const withoutMilestone = []
  const otherEpics = []
  for (const issue of (issues || [])) {
    const title = epicTitleOf(issue)
    if (title === null) withoutMilestone.push(issue)
    else if (title === milestoneTitle) inEpic.push(issue)
    else otherEpics.push(issue)
  }
  // The KEYS stay Spanish: they are the shape gh-issues.test.js compares with
  // `toEqual` and the one ct-groom.mjs destructures — a contract, not a name.
  return { inEpic, sinMilestone: withoutMilestone, otrosEpics: otherEpics }
}
