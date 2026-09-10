// /ct-harvest also reads the judge's telemetry (§3.4 of the handoff:
// docs/prompt-juez-lo-que-queda.md). `rubric_sin_vara` and `findings_by_rule`
// had been travelling in the pull request since `1422c67` and NOBODY READ THEM
// — the column existed on disk and the question «is the yardstick arriving?»
// was answered by opening `jsonl` files by hand.
//
// A bench TRACED from ct-status.test.js but WITHOUT a git checkout:
// ct-harvest.mjs does not look at the cwd — it reads from GitHub, like
// everything else in this command — so no local repo is needed, only the `gh`
// stub on the PATH.
//
// The fixture's issues do NOT carry `closedByPullRequestsReferences` (they go
// empty): the `gh` stub does not support `gh pr view`, so no test in this file
// can depend on ct-harvest trying to read a PR.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-harvest.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (o = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...o })

const ISSUES = [
  { number: 12, title: 'Slice 1', state: 'closed', closedAt: '2026-08-20T10:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
  { number: 13, title: 'Slice 2', state: 'closed', closedAt: '2026-08-20T11:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
]

const TIMELINE = JSON.stringify([
  { event: 'labeled', label: { name: 'status:ready' }, created_at: '2026-08-20T09:00:00Z' },
  { event: 'labeled', label: { name: 'status:in-progress' }, created_at: '2026-08-20T09:05:00Z' },
  { event: 'labeled', label: { name: 'status:in-review' }, created_at: '2026-08-20T09:50:00Z' },
])

// The telemetry directory: issue-12.jsonl (of this milestone) and
// issue-99.jsonl (of ANOTHER epic — it must never be requested nor appear).
// #13 is deliberately left out of the listing: it is the "no telemetry" slice.
const DIR_JSON = JSON.stringify([
  { name: 'issue-12.jsonl', type: 'file' },
  { name: 'issue-99.jsonl', type: 'file' },
])

const verdict = (m) => JSON.stringify({ step: 'judge', ...m }) + '\n'
const implementAttempt = (m) => JSON.stringify({ step: 'implement', ...m }) + '\n'

// The normalized tool usage of one attempt: the tool that spent it, the exact
// tokens it reported and the request ids that name the evidence it claimed.
const usage = ({ evidence, input, cached, output, ...rest }) => ({
  tool: 'claude-code', tool_version: '2.1.266', tool_usage_status: 'measured',
  tool_input_tokens: input, tool_cached_input_tokens: cached, tool_output_tokens: output,
  tool_total_tokens: input + cached + output,
  tool_duration_status: 'unsupported', tool_active_duration_ms: null,
  tool_usage_evidence: evidence, tool_usage_gaps: 0,
  ...rest,
})

function bench() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-hv-'))
  return { dir, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv') }
}
const cleanup = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvOf = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')

const run = (b, env = {}, args = ['--repo', 'o/r', '--milestone', 'E']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  env: fakeEnv({
    FAKE_GH_COUNTER_FILE: b.counter,
    FAKE_GH_ARGV_LOG_FILE: b.argvLog,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([ISSUES]),
    FAKE_GH_TIMELINE_JSON: TIMELINE,
    ...env,
  }),
})

describe('/ct-harvest — the judge telemetry, per slice', () => {
  it('the block comes out with each slice sin-vara and findings per rule, and exit 0', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 1, findings_by_rule: { patrones: 1 } })
        + verdict({ ruling: 'FAIL', rubric_sin_vara: 1, findings_by_rule: { patrones: 1, alcance: 1 } }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 2 \| patrones 2 · alcance 1 \|/)
    cleanup(b)
  })

  // THE SEVERITY, in a single cell and in the order in which it is read: a high
  // vetoes (the verdict's contract does not admit a PASS with a high), a medium
  // buys a round trip to the implementer, a low is only noted down. Three
  // `alcance` findings without this are indistinguishable from three vetoes.
  it('the three severities come out added up in a single cell, in the high/medium/low order', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, findings_high: 1, findings_medium: 0, findings_low: 1 })
        + verdict({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: { alcance: 1 }, findings_high: 0, findings_medium: 1, findings_low: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 0 \| patrones 2 · alcance 1 \| 1\/1\/1 \|/)
    cleanup(b)
  })

  it('a slice whose telemetry is all older than the severities prints «—», never 0/0/0', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {} }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(none\) \| — \|/)
    expect(res.stdout).toMatch(/`—` in `high\/medium\/low`: no verdict of that slice carried the/)
    cleanup(b)
  })

  it('a slice the judge measured clean prints three real zeros and notes no veto at all', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {}, findings_high: 0, findings_medium: 0, findings_low: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(none\) \| 0\/0\/0 \|/)
    cleanup(b)
  })

  it('the vetoes and the rows with no column fit in the same verdicts cell, separated by a comma', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'FAIL' }) + verdict({ ruling: 'FAIL', rubric_sin_vara: 1 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetoes, 1 no column\) \|/)
    cleanup(b)
  })

  // MEASURE 1: whether the ct yardstick was used and whether it caught
  // anything, in a single cell and its two halves. It replaces `patrones-ct`,
  // which only looked at findings of the `patrones` item and for that reason did
  // not see the ones the judge files under another item.
  it('vara ct prints both halves added up over all the verdicts of the slice', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5, findings_vara_ct: 1 })
        + verdict({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 1 }, rubric_vara_ct_docs: 4, findings_vara_ct: 1 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetoes\) \| 0 \| patrones 3 \| — \| 9 docs · 2 findings \|/)
    cleanup(b)
  })

  it('a slice whose telemetry is all older than these columns prints «—» in vara ct, never 0', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 } }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` in `vara ct`: no verdict of that slice carried the/)
    cleanup(b)
  })

  it('half a measure does not print half a cell: with one column alone it comes out «—», because the gap would be read as a zero', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    cleanup(b)
  })

  // MEASURE 2: whether the yardstick reached the brief of the `implement` step,
  // and how much it weighed. Added up over ALL the `implement` attempts the
  // slice left written — the same per-issue file the judge's telemetry reads.
  it('brief adds up the ct yardstick documents and the weight of every implement attempt of the slice', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        implementAttempt({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + implementAttempt({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 })
        + verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(none\) \| — \| — \| 8 docs · 1020B \|/)
    cleanup(b)
  })

  it('a slice with no implement attempt at all in its telemetry says «—» in brief, never 0', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(none\) \| — \| — \| — \|/)
    cleanup(b)
  })

  it('a slice whose implement attempts are all older than the measure says «—» in brief, never 0, and says so out loud', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      // Old schema: an `implement` row with no brief_vara_ct_docs/brief_bytes.
      'issue-12.jsonl': implementAttempt({ outcome: 'done' }) + verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(none\) \| — \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` in `brief`: no `implement` attempt of that slice carried `brief_vara_ct_docs`\/`brief_bytes`/)
    cleanup(b)
  })

  it('the tool and its exact tokens come out in the two columns that let two tools be compared', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        implementAttempt(usage({ evidence: ['req_a'], input: 10, cached: 1000, output: 100, outcome: 'done' }))
        + verdict(usage({ evidence: ['req_b'], input: 5, cached: 500, output: 50, outcome: 'failed', ruling: 'FAIL' }))
        + verdict(usage({ evidence: ['req_c'], input: 5, cached: 500, output: 50, outcome: 'corrections-ordered', ruling: 'PASS' })),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| 1\+1=2 of 2 \| claude-code 2\.1\.266 \| 2220 \(20 in · 2000 cached · 200 out\) \|/)
    cleanup(b)
  })

  it('a slice whose telemetry is older than the tool usage prints «—» in tool and tokens, never a zero', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ outcome: 'done', ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| 0\+0=0 of 1 \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` in `tool`\/`tokens`: no attempt of that slice carried the normalized tool usage/)
    cleanup(b)
  })

  it('a slice whose telemetry carries no judge attempt that ruled prints «—» in returns, never a zero out of zero', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': implementAttempt({ outcome: 'done' }) + verdict({ outcome: 'discarded', why: 'no verdict' }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \|.*\| — \| — \| — \|$/m)
    cleanup(b)
  })

  it('a runtime that reported no usage prints its status instead of a token count nobody measured', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({
        outcome: 'done', ruling: 'PASS',
        tool: 'claude-code', tool_version: '2.1.266', tool_usage_status: 'not-read',
        tool_input_tokens: null, tool_cached_input_tokens: null, tool_output_tokens: null, tool_total_tokens: null,
        tool_duration_status: 'not-read', tool_active_duration_ms: null,
        tool_usage_evidence: [], tool_usage_gaps: null,
      }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| claude-code 2\.1\.266 \| \(not-read\) \|/)
    cleanup(b)
  })

  it('an implement attempt whose brief was not read (null) does not count as zero: it is noted as "no column"', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        implementAttempt({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + implementAttempt({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null })
        + verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/4 docs · 500B \(1 no column\) \|/)
    cleanup(b)
  })

  // MEASURE 3 (#92): how much fixed material each dispatched role read. Added
  // up over the four steps that call a subagent, not only over `implement`.
  it('bytes per role adds up the agent, the skills and the package of every dispatched role of the slice', () => {
    const b = bench()
    const bytes = { agent_bytes: 5000, skill_bytes: 18000, package_bytes: 1000 }
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        implementAttempt({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 1000, ...bytes })
        + verdict({ ruling: 'PASS', rubric_sin_vara: 0, ...bytes }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| agent 10000B · skills 36000B · package 2000B \|/)
    cleanup(b)
  })

  it('a slice whose roles are all older than the measure says «—» in bytes per role, never 0, and says so out loud', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': implementAttempt({ outcome: 'done' }) + verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/`—` in `bytes per role`: no dispatched role of that slice carried `agent_bytes`\/`skill_bytes`\/`package_bytes`/)
    cleanup(b)
  })

  it('a slice with no telemetry file says «(no telemetry)» and never a zero', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #13 \| Slice 2 \| — \| — \| \(no telemetry\) \|/)
    expect(res.stdout).toMatch(/Nobody measured — it is not a zero/)
    cleanup(b)
  })

  it('a slice whose telemetry is all older than the column prints «—» in sin-vara, never 0, and shows how many verdicts have no column', () => {
    const b = bench()
    // A single verdict row WITHOUT `rubric_sin_vara`: the schema older than the
    // column (the 15 rows of PR #11 of jjponz/rust-monitoring are of this kind).
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS' }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\(1 no column\)/)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 no column\) \| — \|/)
    expect(res.stdout).toMatch(/telemetry older than `rubric_sin_vara`/)
    cleanup(b)
  })

  it('a telemetry listing that fails does not drop the exit to 1, and the report prints not a single number', () => {
    const b = bench()
    // Without FAKE_GH_METRICS_DIR_JSON: the stub makes the directory listing
    // fail (a simulated 404), which is real life for every epic older than
    // 1422c67.
    const res = run(b, {})
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/could not list/)
    expect(res.stdout).not.toMatch(/\| Verdicts \|/)
    cleanup(b)
  })

  it('a file the listing did name and could not be read is an INCOMPLETE harvest: reason and exit 1', () => {
    const b = bench()
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILE_FAIL: 'issue-12' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/telemetr/i)
    expect(res.stderr).toMatch(/#12/)
    cleanup(b)
  })

  it('the unreadable lines are said out loud and do not change the exit', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': '{no json\n' + verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/unreadable line\(s\)/)
    cleanup(b)
  })

  it('the telemetry files of other epics do not show up', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/#99/)
    expect(argvOf(b)).not.toMatch(/issue-99/)
    cleanup(b)
  })

  it('--json carries the telemetry inside each row, with the status explicit', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson }, ['--repo', 'o/r', '--milestone', 'E', '--json'])
    expect(res.status).toBe(0)
    const output = JSON.parse(res.stdout)
    expect(output.filas[0].telemetry.status).toBe('ok')
    expect(output.filas[1].telemetry.status).toBe('sin-fichero')
    expect(output.telemetry.dir).toBe('docs/superpowers/metrics')
    cleanup(b)
  })

  it('reads exactly where ct-step writes', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(argvOf(b)).toMatch(/api repos\/o\/r\/contents\/docs\/superpowers\/metrics\/issue-12\.jsonl/)
    cleanup(b)
  })

  it('the harvest still mutates nothing: not one write call', () => {
    const b = bench()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = run(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    const lines = argvOf(b).split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toMatch(/issue edit|issue create|label create|--method (POST|PATCH|PUT|DELETE)|-X (POST|PATCH|PUT|DELETE)/)
    }
    cleanup(b)
  })
})
