// A slab of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, writeSliceVerdict, commits, runState, judgeTask, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('a veto leaves no trace to undo', () => {
  const veto = () => judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
  // The adviser of the second veto, down the happy path: what this describe
  // measures is the veto, not the advice (that is in ct-step-advice.test.js).
  const advise = () => {
    ct('next')
    const p = join(repo, 'advice.json')
    writeFileSync(p, JSON.stringify({ approach: 'por otro camino', files_to_reconsider: [] }))
    return ct('advice', p)
  }

  it('three vetoes exhaust the budget, exit with 1 and do NOT commit', () => {
    // H9: between the second veto and the third attempt the run passes through
    // `advise`, so the third attempt does not start until advice is accepted.
    for (let i = 0; i < 3; i++) {
      ct('report', writeReport(['uno.txt']))
      ct('controls')
      var r = veto()
      if (runState().step === 'advise') advise()
    }
    expect(r.status).toBe(1)
    expect(commits()).toBe(1)
  })

  it('a PASS with medium findings corrects and then delivers all the same', () => {
    const complaint = () => judgeTask(writeVerdict('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'uno.txt', line: 1 }]))
    for (let i = 0; i < 3; i++) {
      ct('report', writeReport(['uno.txt']))
      ct('controls')
      complaint()
    }
    expect(runState().step).toBe('commit')     // budget exhausted: it delivers
    expect(ct('commit').status).toBe(0)
    expect(commits()).toBe(2)
  })
})

describe('a verdict that cannot be read is not a verdict', () => {
  const prepare = () => { ct('report', writeReport(['uno.txt'])); ct('controls') }

  it('a JSON that does not parse is a DISCARD, not a usage error', () => {
    prepare()
    const r = judgeTask(writeRaw('esto no es json'))
    expect(r.stdout).toMatch(/veredicto descartado/)
    expect(runState().discards).toBe(1)
    expect(runState().step).toBe('judge')      // it gets asked again
  })

  it('a made-up ruling is discarded', () => {
    prepare()
    expect(judgeTask(writeVerdict('QUIZÁS')).stdout).toMatch(/ruling desconocido/)
  })

  it('a PASS with a serious finding is discarded: it contradicts itself', () => {
    prepare()
    const r = judgeTask(writeVerdict('PASS', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(r.stdout).toMatch(/contradice la rúbrica/)
  })

  it('discarding without stopping is cut off with 3 instead of going on asking', () => {
    prepare()
    let r
    for (let i = 0; i < 7; i++) r = judgeTask(writeRaw('nada'))
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/descartes en este run/)
  })
})

// Slice 3 of the Capde entries. In a real run an agent chained
// report→controls→verdict without passing through `next` again, which is the
// ONLY step that generates the package the judge judges: the judge judged
// blind and its PASS only failed to land because it declared by itself that it
// could not find the package. Without that confession, the PASS landed and the
// telemetry row was left pointing at a file that does not exist. A step that
// demands an input and does not check that it arrived delegates its guarantee
// to the honesty of the agent.
describe('a verdict issued with no review package is not a verdict', () => {
  it('verdict with no .diff on disk discards, does not advance the step, and measures it as discarded', () => {
    // The exact failure mode, with no tricks: `verdict` is reached WITHOUT
    // passing through `next`. Nothing is deleted — the file does not exist
    // because nobody generated it.
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-review.diff'))).toBe(false)

    const r = ct('verdict', writeVerdict('PASS'))
    expect(r.status).toBe(0)                 // a discard, not a closure: it gets asked again
    expect(r.stdout).toMatch(/veredicto descartado: el paquete de revisión no existe/)
    expect(r.stdout).toContain('el juez juzgó a ciegas')
    expect(r.stdout).toContain('vuelve a "ct-step next"')
    expect(runState().step).toBe('judge')      // it does NOT advance the step
    expect(runState().discards).toBe(1)        // and it counts towards MAX_DISCARDS
    expect(commits()).toBe(1)                // the blind PASS commits nothing
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)

    // RESERVATION 3 of the review: the ROW of the discard, not only the
    // discard. Telemetry is the layer that let the gap be seen (a judge row
    // naming a .diff that does not exist), so it is the one that has to fix it.
    const rows = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const judge = rows.filter((f) => f.step === 'judge')
    expect(judge).toHaveLength(1)
    expect(judge[0].outcome).toBe('discarded')
    expect(judge[0].why).toMatch(/paquete de revisión no existe/)
    // A discard is NOT a verdict: with no `ruling`, aggregateVerdictMeasures
    // does not count it as one (run-metrics.js), and with no `review_package`
    // the row does not assert a file that does not exist.
    expect(judge[0].ruling).toBeUndefined()
    expect(judge[0].review_package).toBeUndefined()
  })

  it('slice-verdict with no slice-review.diff on disk discards, does not advance the step, and measures it as discarded', () => {
    // The two tasks committed and the Global verification green, but without
    // going back to `next`: `writeSliceReviewPackage` has never run.
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')
    expect(existsSync(join(repo, '.agent', 'run-7', 'slice-review.diff'))).toBe(false)

    const r = ct('slice-verdict', writeSliceVerdict('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto de slice descartado: el paquete de revisión del slice no existe/)
    expect(r.stdout).toContain('vuelve a "ct-step next"')
    expect(runState().step).toBe('slice-judge')
    expect(runState().discards).toBe(1)
    expect(runState().closed ?? null).toBeNull()   // a run does not DELIVER blind
    expect(commits()).toBe(3)                    // 1 base + 2 tasks: no verdict commit at all
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)

    const rows = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const judge = rows.filter((f) => f.step === 'slice-judge')
    expect(judge).toHaveLength(1)
    expect(judge[0].outcome).toBe('discarded')
    expect(judge[0].why).toMatch(/paquete de revisión del slice no existe/)
    expect(judge[0].ruling).toBeUndefined()
  })
})
