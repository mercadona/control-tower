import { describe, it, expect } from 'vitest'
import { flattenIssuePages, isPullRequest, realIssuesOnly, findByMarker, epicTitleOf, partitionByEpic } from '../scripts/gh-issues.js'

describe('flattenIssuePages', () => {
  it('it flattens the array of pages --paginate --slurp produces', () => {
    const pages = [
      [{ number: 1, body: 'a' }, { number: 2, body: 'b' }],
      [{ number: 3, body: 'c' }],
    ]
    expect(flattenIssuePages(pages)).toEqual([
      { number: 1, body: 'a' },
      { number: 2, body: 'b' },
      { number: 3, body: 'c' },
    ])
  })
  it('a single page (a single array entry) is flattened correctly too', () => {
    const pages = [[{ number: 1, body: 'a' }]]
    expect(flattenIssuePages(pages)).toEqual([{ number: 1, body: 'a' }])
  })
  it('defensive: a non-array input returns []', () => {
    expect(flattenIssuePages(null)).toEqual([])
    expect(flattenIssuePages(undefined)).toEqual([])
  })
})

describe('isPullRequest / realIssuesOnly', () => {
  it('it discards entries carrying the pull_request key', () => {
    const entries = [
      { number: 1, body: 'issue real' },
      { number: 2, body: 'esto es un PR', pull_request: { url: 'x' } },
    ]
    expect(isPullRequest(entries[1])).toBe(true)
    expect(isPullRequest(entries[0])).toBe(false)
    expect(realIssuesOnly(entries)).toEqual([{ number: 1, body: 'issue real' }])
  })
  it('defensive: an empty input does not blow up', () => {
    expect(realIssuesOnly(undefined)).toEqual([])
    expect(isPullRequest(undefined)).toBe(false)
  })
})

describe('findByMarker', () => {
  it('it matches the exact marker of a slice', () => {
    const issues = [
      { number: 10, body: 'algo\n<!-- ct-order:2 -->' },
      { number: 11, body: 'otro\n<!-- ct-order:3 -->' },
    ]
    const found = findByMarker(issues, '<!-- ct-order:2 -->')
    expect(found.number).toBe(10)
  })
  it('it does NOT match the marker of another order', () => {
    const issues = [{ number: 11, body: 'otro\n<!-- ct-order:3 -->' }]
    expect(findByMarker(issues, '<!-- ct-order:2 -->')).toBeUndefined()
  })
  it('a PR already filtered out beforehand cannot match by mistake', () => {
    const entries = [
      { number: 1, body: 'PR body con <!-- ct-order:2 --> por casualidad', pull_request: {} },
    ]
    const onlyIssues = realIssuesOnly(entries)
    expect(findByMarker(onlyIssues, '<!-- ct-order:2 -->')).toBeUndefined()
  })
})

// F23 — the per-epic scope. epicTitleOf/partitionByEpic are to /ct-groom what
// epicKeyOf/buildOrderIndex (gh-issue-map.js) are to /ct-next: the same idea,
// with the key each of them can afford. /ct-next uses the milestone's NUMBER;
// /ct-groom cannot, because it enumerates the repo's issues BEFORE having
// resolved (or created) the run's milestone, so at that point the only thing it
// knows about the epic is its TITLE.
describe('epicTitleOf', () => {
  it('it returns the title of the milestone', () => {
    expect(epicTitleOf({ number: 1, milestone: { number: 4, title: 'Epic A' } })).toBe('Epic A')
  })
  it('with no milestone → null', () => {
    expect(epicTitleOf({ number: 1, milestone: null })).toBeNull()
    expect(epicTitleOf({ number: 1 })).toBeNull()
  })
  it('a milestone with no usable title → null (it does not blow up, it falls into the shared bucket)', () => {
    expect(epicTitleOf({ milestone: {} })).toBeNull()
    expect(epicTitleOf({ milestone: { title: '' } })).toBeNull()
    expect(epicTitleOf({ milestone: { title: 42 } })).toBeNull()
  })
  it('defensive: an empty input does not blow up', () => {
    expect(epicTitleOf(undefined)).toBeNull()
    expect(epicTitleOf(null)).toBeNull()
  })
})

describe('partitionByEpic', () => {
  const issues = [
    { number: 1, milestone: { title: 'Epic A' } },
    { number: 2, milestone: { title: 'Epic B' } },
    { number: 3, milestone: null },
    { number: 4, milestone: { title: 'Epic A' } },
  ]
  it('it sorts into the three buckets, disjoint and in the input order', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic A')
    expect(inEpic.map((i) => i.number)).toEqual([1, 4])
    expect(sinMilestone.map((i) => i.number)).toEqual([3])
    expect(otrosEpics.map((i) => i.number)).toEqual([2])
  })
  it('the title is compared EXACTLY: there is no normalisation of case or whitespace', () => {
    const { inEpic, otrosEpics } = partitionByEpic(issues, 'epic a')
    expect(inEpic).toEqual([])
    expect(otrosEpics.map((i) => i.number)).toEqual([1, 2, 4])
  })
  it('a requested title that does not exist leaves inEpic empty without losing anybody', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic Z')
    expect(inEpic).toEqual([])
    expect(sinMilestone.length + otrosEpics.length).toBe(issues.length)
  })
  it('defensive: an empty or absent list returns the three buckets empty', () => {
    for (const input of [[], undefined, null]) {
      const p = partitionByEpic(input, 'Epic A')
      expect(p).toEqual({ inEpic: [], sinMilestone: [], otrosEpics: [] })
    }
  })
})

describe('normalizeGraphqlIssues — it translates the GraphQL answer into the REST shape the rest of the code expects', () => {
  it('it flattens pages, lowercases state and normalises labels/milestone', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    const pages = [
      { data: { repository: { issues: { nodes: [
        { number: 501, title: '#1 login', body: 'x <!-- ct-order:1 -->', state: 'OPEN', milestone: { title: 'Epic' }, labels: { nodes: [{ name: 'type:backend' }, { name: 'area:api' }] } },
      ], pageInfo: { hasNextPage: true, endCursor: 'a' } } } } },
      { data: { repository: { issues: { nodes: [
        { number: 502, title: '#2 scoring', body: 'y <!-- ct-order:2 -->', state: 'CLOSED', milestone: null, labels: { nodes: [] } },
      ], pageInfo: { hasNextPage: false, endCursor: 'b' } } } } },
    ]
    expect(normalizeGraphqlIssues(pages)).toEqual([
      { number: 501, title: '#1 login', body: 'x <!-- ct-order:1 -->', state: 'open', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'area:api' }] },
      { number: 502, title: '#2 scoring', body: 'y <!-- ct-order:2 -->', state: 'closed', milestone: null, labels: [] },
    ])
  })
  it('TWO pages → it concatenates the nodes of both in order (it does not lose page 2)', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    const mk = (n) => ({ number: n, title: `#${n}`, body: `<!-- ct-order:${n} -->`, state: 'OPEN', milestone: null, labels: { nodes: [] } })
    const pages = [
      { data: { repository: { issues: { nodes: [mk(1), mk(2)], pageInfo: { hasNextPage: true, endCursor: 'a' } } } } },
      { data: { repository: { issues: { nodes: [mk(3)], pageInfo: { hasNextPage: false, endCursor: 'b' } } } } },
    ]
    expect(normalizeGraphqlIssues(pages).map((i) => i.number)).toEqual([1, 2, 3])
  })
  it('defensive: empty pages or pages with no nodes → []', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    expect(normalizeGraphqlIssues([])).toEqual([])
    expect(normalizeGraphqlIssues([{ data: { repository: { issues: { nodes: [] } } } }])).toEqual([])
    expect(normalizeGraphqlIssues(null)).toEqual([])
  })
  it('defensive: a null/undefined state does not blow up and survives as it is (GitHub always gives OPEN/CLOSED, but if the schema changes the test says so)', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    const pages = [{ data: { repository: { issues: { nodes: [
      { number: 1, title: '#1', body: 'x', state: null, milestone: null, labels: { nodes: [] } },
      { number: 2, title: '#2', body: 'y', state: undefined, milestone: null, labels: { nodes: [] } },
    ] } } } }]
    const out = normalizeGraphqlIssues(pages)
    expect(out[0].state).toBe(null)
    expect(out[1].state).toBe(undefined)
  })
})
