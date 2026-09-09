import { describe, it, expect } from 'vitest'
import { buildStateSeed, renderKickoff } from '../scripts/kickoff.js'
import { parseStateSafe } from '../scripts/state.js'
import { buildIssueBody } from '../scripts/groom.js'
import { mapGhIssue } from '../scripts/gh-issue-map.js'
import { newRun } from '../scripts/run-machine.js'

const slice = (e2e) => ({
  n: 5, issue: '#12', name: 'exposición', type: 'backend', entrega: '', gate: '–',
  deps: [], ac: ['x'], protected: '', area: ['core'], touches: [], e2e,
  gates: ['plan', 'e2e'], gatesDeclared: true,
})

describe('the seed carries the journeys', () => {
  it('the e2e field is a LIST, not a sentence', () => {
    const md = buildStateSeed(slice('uno, dos'), { branch: 'feat/5', base: 'main', baseSha: 'abc' })
    const { meta } = parseStateSafe(md)
    expect(meta.e2e).toEqual(['uno', 'dos'])
  })

  it('with no journeys, the field is an empty list and does not disappear', () => {
    const { meta } = parseStateSafe(buildStateSeed(slice('no'), { branch: 'feat/5', base: 'main', baseSha: 'abc' }))
    expect(meta.e2e).toEqual([])
  })

  it('the kickoff names the journeys and orders them closed with ct-step e2e', () => {
    const k = renderKickoff(slice('curl -i :9115/metrics responde 200'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain('curl -i :9115/metrics responde 200')
    expect(k).toMatch(/ct-step e2e/)
  })

  it('with no journeys, the kickoff does not talk about e2e', () => {
    const k = renderKickoff(slice('no'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' , conventionsDir: '/plugin/conventions' })
    expect(k).not.toMatch(/ct-step e2e/)
  })
})

// An end-to-end property (T9, the brief asks for it explicitly): the whole
// chain "spec cell -> issue section -> .agent/SLICE.md -> newRun({e2eRuns})"
// had no test walking it in one go. Any of its first three legs (resolveE2e,
// buildIssueBody/mapGhIssue, buildStateSeed) can rename its field without any
// unit test noticing — this is the one that would notice.
//
// MIND THE FOURTH LEG: the test below calls `newRun` DIRECTLY with
// `e2eRuns: meta.e2e` — it checks that `newRun` accepts and stores that
// parameter, not that `ct-step.mjs` (line 221,
// `newRun({ ..., e2eRuns: sliceMeta.e2e })`) still reads the right field of
// `sliceMeta`. A rename on THAT line would not be detected by this test: it
// would take running the binary, not the function.
describe('the complete chain: spec cell -> issue section -> SLICE.md -> newRun (T9, end-to-end property)', () => {
  it('a journey with an escaped comma in the spec survives the whole trip as far as run.e2eRuns', () => {
    // 1. The raw spec cell, with an ESCAPED comma inside the journey itself
    // (not separating two journeys) — the case resolveE2e/splitEscapedCommas
    // exist so as not to split in two.
    const specSlice = {
      n: 9, entrega: 'expone métricas', ac: ['AC-9.1 expone /metrics'], deps: [], protected: '–',
      e2e: 'curl -i :9115/metrics responde 200\\, sin auth',
    }
    const specRef = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }

    // 2. /ct-groom writes the issue's body: the "## E2E" section with the
    // journey ALREADY resolved (the escaped comma, now a literal comma).
    const body = buildIssueBody(specSlice, specRef)
    expect(body).toContain('## E2E')
    expect(body).toContain('- curl -i :9115/metrics responde 200, sin auth')

    // 3. /ct-next rebuilds the slice FROM THE ISSUE (it never opens the spec):
    // mapGhIssue extracts that same section into `e2eRuns`.
    const issueSlice = mapGhIssue({
      number: 9, title: '#9 expone métricas',
      labels: [{ name: 'status:ready' }, { name: 'type:backend' }],
      body,
    })
    expect(issueSlice.e2eRuns).toEqual(['curl -i :9115/metrics responde 200, sin auth'])

    // 4. buildStateSeed seeds that array into .agent/SLICE.md — parseStateSafe
    // is the same reader ct-step.mjs uses.
    const seed = buildStateSeed(issueSlice, { branch: 'feat/9', base: 'main', baseSha: 'deadbeef' })
    const { meta } = parseStateSafe(seed)
    expect(meta.e2e).toEqual(['curl -i :9115/metrics responde 200, sin auth'])

    // 5. ct-step.mjs (line 221) passes `sliceMeta.e2e` as `e2eRuns` to
    // newRun — the real consumption point Task 8 already left built.
    const run = newRun({ plan: 'docs/plan.md', issue: 9, baseSha: 'deadbeef', tasksTotal: 1, e2eRuns: meta.e2e })
    expect(run.e2eRuns).toEqual(['curl -i :9115/metrics responde 200, sin auth'])
  })

  it('with no journeys in the spec, the whole chain gives `[]` at every leg (never `undefined`)', () => {
    const specSlice = { n: 10, entrega: 'x', ac: ['AC-10.1'], deps: [], protected: '–', e2e: 'no' }
    const specRef = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
    const body = buildIssueBody(specSlice, specRef)
    // groom.js#buildIssueBody omits the WHOLE section when there are no journeys.
    expect(body).not.toContain('## E2E')

    const issueSlice = mapGhIssue({
      number: 10, title: '#10 x',
      labels: [{ name: 'status:ready' }, { name: 'type:backend' }],
      body,
    })
    expect(issueSlice.e2eRuns).toEqual([])

    const seed = buildStateSeed(issueSlice, { branch: 'feat/10', base: 'main', baseSha: 'deadbeef' })
    const { meta } = parseStateSafe(seed)
    expect(meta.e2e).toEqual([])

    const run = newRun({ plan: 'docs/plan.md', issue: 10, baseSha: 'deadbeef', tasksTotal: 1, e2eRuns: meta.e2e })
    expect(run.e2eRuns).toEqual([])
  })
})
