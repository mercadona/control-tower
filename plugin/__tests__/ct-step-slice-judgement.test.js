// A slice of the state machine of scripts/ct-step.mjs. The preamble —and why
// it is nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { renderState } from '../scripts/state.js'
import { SIGNAL_ABSENT } from '../scripts/kickoff.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, sliceRubric } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeSliceVerdict, commits, runState, judgeSlice, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// §3.7-B of the handoff: the whole slice has a judge. The two items no task
// judge ever looks at — whether the tasks together deliver the slice's end, and
// whether they are coherent with each other.
describe('the judgement of the whole slice (§3.7-B)', () => {
  const atSliceJudge = () => { taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global') }

  it('next dispatches ct-slice-judge with the package of the commit RANGE', () => {
    atSliceJudge()
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/ct-slice-judge/)
    expect(r.stdout).toMatch(/SIN Bash/)
    const reviewPackage = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    // The commit sequence is the piece the per-task package does not have:
    // `coherencia` is only visible in the order.
    expect(reviewPackage).toMatch(/## Commits/)
    expect(reviewPackage.indexOf('the first one (#7, tarea 1/2)')).toBeLessThan(reviewPackage.indexOf('the second one (#7, tarea 2/2)'))
    expect(reviewPackage).toMatch(/## Files changed/)
    expect(reviewPackage).toMatch(/## Diff/)
  })

  it('a PASS delivers the run and the verdict travels in its OWN commit', () => {
    atSliceJudge()
    const r = judgeSlice(writeSliceVerdict('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(runState().closed).toBe('delivered')
    expect(commits()).toBe(4)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/issue-7-slice\.json/)
    const saved = JSON.parse(readFileSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'), 'utf8'))
    expect(saved.verdict.ruling).toBe('PASS')
    expect(saved.tasks_total).toBe(2)
  })

  it('a PASS with medium findings delivers all the same: there is no implementer left to send it back to', () => {
    atSliceJudge()
    const r = judgeSlice(writeSliceVerdict('PASS', [{ severity: 'medium', what: 'andamiaje sin retirar', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(0)
    expect(runState().closed).toBe('delivered')
    // The finding travels INSIDE the committed verdict, for whoever reviews the pull request.
    const saved = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-slice.json'], { cwd: repo, encoding: 'utf8' }))
    expect(saved.verdict.findings).toHaveLength(1)
  })

  it('a FAIL closes the run with 1 and leaves NO tracked verdict: only the one that approves travels', () => {
    atSliceJudge()
    const r = judgeSlice(writeSliceVerdict('FAIL', [{ severity: 'high', what: 'la tarea 2 deshace la 1', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(1)
    expect(commits()).toBe(3)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)
  })

  it('a verdict with a TASK rule is discarded and the question is asked again', () => {
    atSliceJudge()
    const p = join(repo, 'sv.json')
    writeFileSync(p, JSON.stringify({ ruling: 'PASS', rubric: sliceRubric(), findings: [{ rule: 'alcance', severity: 'low', what: 'x', path: 'y', evidence: 'z' }] }))
    const r = judgeSlice(p)
    expect(r.stdout).toMatch(/descartado/)
    expect(runState().step).toBe('slice-judge')
    expect(runState().discards).toBe(1)
  })

  it('the global and slice-judge rows belong to no task, and travel in the verdict commit', () => {
    atSliceJudge()
    judgeSlice(writeSliceVerdict('PASS'))
    const committed = execFileSync('git', ['show', 'HEAD:docs/superpowers/metrics/issue-7.jsonl'], { cwd: repo, encoding: 'utf8' })
    const rows = committed.trim().split('\n').map((l) => JSON.parse(l))
    const global = rows.find((f) => f.step === 'global')
    expect(global.task).toBeNull()
    expect(global.task_name).toBeNull()
    const judge = rows.find((f) => f.step === 'slice-judge')
    expect(judge.task).toBeNull()
    expect(judge.ruling).toBe('PASS')
  })

  // Slice 10 — the signal crosses the funnel inside the package: ct-step reads
  // it from the `senal:` field of SLICE.md (disk, with no agent in between —
  // the doctrine of §3.3) and pastes it into `## Señal`, ahead of the -U10 diff
  // where it would be buried (Task 8: the only thing ahead of it is `## Vara`).
  // The SIGNAL_ABSENT fallback covers a SLICE.md seeded by a plugin older than
  // the column.
  const seedSignalInSliceMd = (signal) => {
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // Through the SAME path as buildStateSeed (renderState): that is what makes
    // a long value arrive folded/quoted by YAML, as in a real dispatch.
    writeFileSync(join(repo, '.agent', 'SLICE.md'), renderState({ meta: { issue: 7, epic: 12, senal: signal }, body: '# slice de mentira' }))
    g('add', '.agent/SLICE.md')
    g('commit', '-q', '-m', 'siembra la senal del slice')
  }

  it('the slice package carries "## Señal" ahead of Commits/Files changed/Diff, with the text of the senal: field of SLICE.md', () => {
    seedSignalInSliceMd('métrica `backfill_progress` con label `estado`')
    atSliceJudge()
    ct('next')
    const reviewPackage = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(reviewPackage).toMatch(/## Señal/)
    expect(reviewPackage).toContain('métrica `backfill_progress` con label `estado`')
    // First: ahead of Commits/Files changed/Diff.
    expect(reviewPackage.indexOf('## Señal')).toBeLessThan(reviewPackage.indexOf('## Commits'))
  })

  it('with no senal: field in the SLICE.md, the section declares the absence with SIGNAL_ABSENT', () => {
    // The montarRepo fixture seeds a SLICE.md WITHOUT a senal field — the case
    // of a plugin older than the column.
    atSliceJudge()
    ct('next')
    const reviewPackage = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(reviewPackage).toMatch(/## Señal/)
    expect(reviewPackage).toContain(SIGNAL_ABSENT)
    expect(reviewPackage.indexOf('## Señal')).toBeLessThan(reviewPackage.indexOf('## Commits'))
  })

  it('a long signal (folded by YAML) arrives whole in the package', () => {
    // > 100 characters in a single piece: renderState (yaml.stringify) folds it
    // across several frontmatter lines — a single-line regex (the one for
    // `epic:`) would truncate it and the item's yardstick would arrive half
    // there with nobody seeing it. This is the reason for parseStateSafe.
    const longSignal = 'métrica `harvest_rows_total` con label `estado` acotado a los valores enumerados del contrato, emitida por el worker de cosecha en cada lote confirmado'
    expect(longSignal.length).toBeGreaterThan(100)
    seedSignalInSliceMd(longSignal)
    atSliceJudge()
    ct('next')
    const reviewPackage = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(reviewPackage).toContain(longSignal)
  })
})
