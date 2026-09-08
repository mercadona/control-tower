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

const veredicto = (m) => JSON.stringify({ step: 'judge', ...m }) + '\n'
const intentoImplement = (m) => JSON.stringify({ step: 'implement', ...m }) + '\n'

function bancada() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-hv-'))
  return { dir, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv') }
}
const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvDe = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')

const correr = (b, env = {}, args = ['--repo', 'o/r', '--milestone', 'E']) => spawnSync('node', [script, ...args], {
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
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 1, findings_by_rule: { patrones: 1 } })
        + veredicto({ ruling: 'FAIL', rubric_sin_vara: 1, findings_by_rule: { patrones: 1, alcance: 1 } }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 2 \| patrones 2 · alcance 1 \|/)
    limpiar(b)
  })

  // THE SEVERITY, in a single cell and in the order in which it is read: a high
  // vetoes (the verdict's contract does not admit a PASS with a high), a medium
  // buys a round trip to the implementer, a low is only noted down. Three
  // `alcance` findings without this are indistinguishable from three vetoes.
  it('the three severities come out added up in a single cell, in the alta/media/baja order', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, findings_high: 1, findings_medium: 0, findings_low: 1 })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: { alcance: 1 }, findings_high: 0, findings_medium: 1, findings_low: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 0 \| patrones 2 · alcance 1 \| 1\/1\/1 \|/)
    limpiar(b)
  })

  it('a slice whose telemetry is all older than the severities prints «—», never 0/0/0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {} }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \|/)
    expect(res.stdout).toMatch(/`—` en `alta\/media\/baja`: ningún veredicto de ese slice traía las severidades/)
    limpiar(b)
  })

  it('a slice the judge measured clean prints three real zeros and notes no veto at all', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {}, findings_high: 0, findings_medium: 0, findings_low: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| 0\/0\/0 \|/)
    limpiar(b)
  })

  it('the vetoes and the rows with no column fit in the same verdicts cell, separated by a comma', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL' }) + veredicto({ ruling: 'FAIL', rubric_sin_vara: 1 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetos, 1 sin columna\) \|/)
    limpiar(b)
  })

  // MEASURE 1: whether the ct yardstick was used and whether it caught
  // anything, in a single cell and its two halves. It replaces `patrones-ct`,
  // which only looked at findings of the `patrones` item and for that reason did
  // not see the ones the judge files under another item.
  it('vara ct prints both halves added up over all the verdicts of the slice', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5, findings_vara_ct: 1 })
        + veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 1 }, rubric_vara_ct_docs: 4, findings_vara_ct: 1 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetos\) \| 0 \| patrones 3 \| — \| 9 docs · 2 hallazgos \|/)
    limpiar(b)
  })

  it('a slice whose telemetry is all older than these columns prints «—» in vara ct, never 0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 } }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` en `vara ct`: ningún veredicto de ese slice traía las columnas/)
    limpiar(b)
  })

  it('half a measure does not print half a cell: with one column alone it comes out «—», because the gap would be read as a zero', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    limpiar(b)
  })

  // MEASURE 2: whether the yardstick reached the brief of the `implement` step,
  // and how much it weighed. Added up over ALL the `implement` attempts the
  // slice left written — the same per-issue file the judge's telemetry reads.
  it('brief adds up the ct yardstick documents and the weight of every implement attempt of the slice', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| 8 docs · 1020B \|/)
    limpiar(b)
  })

  it('a slice with no implement attempt at all in its telemetry says «—» in brief, never 0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| — \|/)
    limpiar(b)
  })

  it('a slice whose implement attempts are all older than the measure says «—» in brief, never 0, and says so out loud', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      // Old schema: an `implement` row with no brief_vara_ct_docs/brief_bytes.
      'issue-12.jsonl': intentoImplement({ outcome: 'done' }) + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` en `brief`: ningún intento de `implement` de ese slice traía `brief_vara_ct_docs`\/`brief_bytes`/)
    limpiar(b)
  })

  it('an implement attempt whose brief was not read (null) does not count as zero: it is noted as "sin columna"', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + intentoImplement({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/4 docs · 500B \(1 sin columna\) \|/)
    limpiar(b)
  })

  // MEASURE 3 (#92): how much fixed material each dispatched role read. Added
  // up over the four steps that call a subagent, not only over `implement`.
  it('bytes por papel adds up the agent, the skills and the package of every dispatched role of the slice', () => {
    const b = bancada()
    const bytes = { agent_bytes: 5000, skill_bytes: 18000, package_bytes: 1000 }
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 1000, ...bytes })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0, ...bytes }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| agente 10000B · skills 36000B · paquete 2000B \|/)
    limpiar(b)
  })

  it('a slice whose roles are all older than the measure says «—» in bytes por papel, never 0, and says so out loud', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': intentoImplement({ outcome: 'done' }) + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/`—` en `bytes por papel`: ningún papel despachado de ese slice traía `agent_bytes`\/`skill_bytes`\/`package_bytes`/)
    limpiar(b)
  })

  it('a slice with no telemetry file says «(sin telemetría)» and never a zero', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #13 \| Slice 2 \| — \| — \| \(sin telemetría\) \|/)
    expect(res.stdout).toMatch(/Nadie midió — no es un cero/)
    limpiar(b)
  })

  it('a slice whose telemetry is all older than the column prints «—» in sin-vara, never 0, and shows how many verdicts have no column', () => {
    const b = bancada()
    // A single verdict row WITHOUT `rubric_sin_vara`: the schema older than the
    // column (the 15 rows of PR #11 of jjponz/rust-monitoring are of this kind).
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS' }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\(1 sin columna\)/)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 sin columna\) \| — \|/)
    expect(res.stdout).toMatch(/telemetría anterior a `rubric_sin_vara`/)
    limpiar(b)
  })

  it('a telemetry listing that fails does not drop the exit to 1, and the report prints not a single number', () => {
    const b = bancada()
    // Without FAKE_GH_METRICS_DIR_JSON: the stub makes the directory listing
    // fail (a simulated 404), which is real life for every epic older than
    // 1422c67.
    const res = correr(b, {})
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/no se pudo listar/)
    expect(res.stdout).not.toMatch(/\| Veredictos \|/)
    limpiar(b)
  })

  it('a file the listing did name and could not be read is an INCOMPLETE harvest: reason and exit 1', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILE_FAIL: 'issue-12' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/telemetr/i)
    expect(res.stderr).toMatch(/#12/)
    limpiar(b)
  })

  it('the unreadable lines are said out loud and do not change the exit', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': '{no json\n' + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/l.nea\(s\) ilegibles/)
    limpiar(b)
  })

  it('the telemetry files of other epics do not show up', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/#99/)
    expect(argvDe(b)).not.toMatch(/issue-99/)
    limpiar(b)
  })

  it('--json carries the telemetry inside each row, with the status explicit', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson }, ['--repo', 'o/r', '--milestone', 'E', '--json'])
    expect(res.status).toBe(0)
    const salida = JSON.parse(res.stdout)
    expect(salida.filas[0].telemetry.status).toBe('ok')
    expect(salida.filas[1].telemetry.status).toBe('sin-fichero')
    expect(salida.telemetry.dir).toBe('docs/superpowers/metrics')
    limpiar(b)
  })

  it('reads exactly where ct-step writes', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(argvDe(b)).toMatch(/api repos\/o\/r\/contents\/docs\/superpowers\/metrics\/issue-12\.jsonl/)
    limpiar(b)
  })

  it('the harvest still mutates nothing: not one write call', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    const lineas = argvDe(b).split('\n').filter(Boolean)
    expect(lineas.length).toBeGreaterThan(0)
    for (const linea of lineas) {
      expect(linea).not.toMatch(/issue edit|issue create|label create|--method (POST|PATCH|PUT|DELETE)|-X (POST|PATCH|PUT|DELETE)/)
    }
    limpiar(b)
  })
})
