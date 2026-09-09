// One piece of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— lives in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, fullRubric, sliceRubric, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, writeSliceVerdict, commits, runState,
  taskPackage, slicePackage, judgeRows, packageToken, seal, judgeTask,
  judgeSlice, taskOk } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// The judge has `Read` (JUDGE_TOOLS), so the ct yardstick reaches it by PATH
// and not pasted: it is the same criterion by which the plan and the files the
// diff touches already reach it. What the path buys over the text is that the
// judge opens only what it is going to cite, instead of reading 24 KB ahead of
// the diff.
describe('the review package gives the ct yardstick by path, not pasted', () => {
  const paquete = () => readFileSync(taskPackage(), 'utf8')

  it('the section opens the package and lists the path of every document that reaches the task', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const texto = paquete()
    expect(texto).toContain('## Vara de ct')
    for (const nombre of PluginYardstick.FILES) {
      expect(texto, `${nombre} no llega ni por ruta`).toContain(join(PLUGIN_ROOT_TEST, 'conventions', nombre))
    }
    expect(texto.indexOf('## Vara de ct')).toBeLessThan(texto.indexOf('## Diff'))
  })

  it('it pastes the text of no document at all', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const style = readFileSync(join(PLUGIN_ROOT_TEST, 'conventions', 'style.md'), 'utf8')
    expect(paquete()).not.toContain(style.trim())
  })
})

// Slice 6 of the Capde notes — the HIGH finding from the review of PR #36,
// reproduced with a real attack. The slice 3 guard covered attempt 1 and left
// attempt 2 open: with attempt 1's `.diff` still on disk, a PASS issued over
// the OLD diff got through, and the telemetry row pointed at a package that
// exists and is the wrong one — a mute failure, worse than the noisy one slice
// 3 fixed. The input becomes something that is spent: the verdict that reads it
// spends it. The rule comes out of run-machine.js — the package is worth
// something as long as the step is still the judge's, so an ACCEPTED verdict
// (which always changes the step) consumes it and a DISCARD (which does not
// change it) does not.
describe('the review package is single-use: the verdict that reads it consumes it', () => {
  // `paqueteDeTarea`/`paqueteDeSlice` now live at module level (Slice 11,
  // compatible signature: same default value for task 1).

  it('THE ATTACK: after a FAIL, chaining report→controls→verdict without next is DISCARDED', () => {
    // ATTEMPT 1, through the real flow: `next` builds the package and the
    // judge VETOES.
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const r1 = judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(r1.stdout).toMatch(/veredicto FAIL/)
    expect(runState().step).toBe('implement')      // the veto hands the task back
    expect(runState().judgeRetries).toBe(1)
    // The verdict took its input away with it. This is the line that was RED
    // before the fix, and with it everything that follows.
    expect(existsSync(taskPackage())).toBe(false)

    // ATTEMPT 2: the implementer changes the file and the conductor chains
    // report→controls→verdict WITHOUT going back to `next` — the attack,
    // literally.
    writeFileSync(join(repo, 'uno.txt'), 'uno, ahora arreglado\n')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const r2 = ct('verdict', writeVerdict('PASS'))
    expect(r2.status).toBe(0)                    // a discard, not a closure
    expect(r2.stdout).toMatch(/veredicto descartado: el paquete de revisión no existe/)
    expect(r2.stdout).toContain('El paquete es de UN SOLO USO')
    expect(runState().step).toBe('judge')          // does NOT advance: it asks again
    expect(runState().discards).toBe(1)
    expect(commits()).toBe(1)                    // the stale PASS commits nothing
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)

    // The TELEMETRY, which is the layer where the failure was mute: two judge
    // rows, and the one from attempt 2 asserts no package at all.
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const juez = filas.filter((f) => f.step === 'judge')
    expect(juez).toHaveLength(2)
    expect(juez[0].ruling).toBe('FAIL')          // attempt 1 did judge, and over its own diff
    expect(juez[1].outcome).toBe('discarded')
    expect(juez[1].ruling).toBeUndefined()
    expect(juez[1].review_package).toBeUndefined()

    // And the honest path stays open: `next` regenerates the package from the
    // NEW index, the judge sees it, and the PASS gets through.
    const r3 = judgeTask(writeVerdict('PASS'))
    expect(r3.stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
    expect(commits()).toBe(2)
  })

  it('the DISCARD does not consume: the retry over unreadable JSON judges the SAME .diff, without going back to next', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const antes = readFileSync(taskPackage(), 'utf8')

    const r1 = ct('verdict', writeRaw('esto no es json'))
    expect(r1.stdout).toMatch(/veredicto descartado: no se pudo leer/)
    expect(runState().step).toBe('judge')
    expect(runState().discards).toBe(1)
    expect(existsSync(taskPackage())).toBe(true)
    expect(readFileSync(taskPackage(), 'utf8')).toBe(antes)   // byte for byte: the same input

    // The judge is asked again WITHOUT going through `next`, which is
    // legitimate: the step has not changed and the package it was going to
    // judge is still the good one. And since the package is still the same, the
    // honest judge copies the SAME token (Slice 11): that is why it is sealed
    // here and not before writing it.
    const r2 = ct('verdict', seal(writeVerdict('PASS'), taskPackage()))
    expect(r2.stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
    expect(existsSync(taskPackage())).toBe(false)             // accepted: now it really is spent
  })

  it('the happy path does not change: every task comes back through next, and its package is spent when it is approved', () => {
    expect(taskOk('uno.txt').status).toBe(0)
    expect(existsSync(taskPackage(1))).toBe(false)
    expect(runState().task).toBe(2)
    expect(taskOk('dos.txt').status).toBe(0)
    expect(existsSync(taskPackage(2))).toBe(false)
    expect(commits()).toBe(3)
  })

  it('THE SLICE TWIN: the discard keeps the package and the accepted verdict spends it', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const antes = readFileSync(slicePackage(), 'utf8')

    expect(ct('slice-verdict', writeRaw('ni json ni nada')).stdout).toMatch(/veredicto de slice descartado/)
    expect(runState().step).toBe('slice-judge')
    expect(existsSync(slicePackage())).toBe(true)
    expect(readFileSync(slicePackage(), 'utf8')).toBe(antes)

    // Asked again without `next` (legitimate: the step did not change) and
    // accepted: it delivers and takes its input away with it. Sealed with the
    // token of the SAME package (Slice 11).
    const r = ct('slice-verdict', seal(writeSliceVerdict('PASS'), slicePackage()))
    expect(r.status).toBe(0)
    expect(runState().closed).toBe('delivered')
    expect(existsSync(slicePackage())).toBe(false)
  })

  it('THE SLICE TWIN: a FAIL also spends the package — it too is a verdict that was read', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    const r = judgeSlice(writeSliceVerdict('FAIL', [{ severity: 'high', what: 'la tarea 2 deshace la 1', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(1)                       // the slice veto closes the run
    expect(existsSync(slicePackage())).toBe(false)
  })
})

// Slice 11 of the Capde notes — the two routes still left open after making the
// package single-use, both MUTE in the telemetry and reproduced against the
// HEAD from before this fix. The input was tied down; the product was not:
// nothing bound the verdict.json to the package. The package now declares in
// its header the sha256 of the diff it captured, the judge copies it, and the
// verb demands that the one in the verdict, the one in the package and the one
// recomputed from the snapshot of that instant all match.
describe('the verdict is tied to the package: the content-addressed token the judge copies', () => {
  it('the package declares the sha256 of the staged diff it captures, and the verdict that copies it gets through', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const token = packageToken(taskPackage())
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    // CONTENT-ADDRESSED, and here is where WHAT gets hashed is fixed: the raw
    // staged diff, which is byte for byte what goes into the `## Diff` section.
    const diff = execFileSync('git', ['diff', '--cached', '-U10'], { cwd: repo, encoding: 'utf8' })
    expect(token).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    expect(readFileSync(taskPackage(), 'utf8').split('\n')[1]).toBe(`Review token: ${token}`)

    expect(ct('verdict', seal(writeVerdict('PASS'), taskPackage())).stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
    expect(ct('commit').status).toBe(0)
    // The token travels in the pull request's verdict and in its row.
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-task-1.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.review_token).toBe(token)
    expect(judgeRows().at(-1).review_token).toBe(token)
    expect(judgeRows().at(-1).ruling).toBe('PASS')
  })

  it('THE ATTACK (a): the verdict of an earlier judging does not slip through just by going back to next', () => {
    // JUDGING 1, legitimate, over code A: a PASS with a medium finding is an
    // ACCEPTED verdict that hands the task back to the implementer, and leaves
    // the verdict file on disk (the same path in every attempt).
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const v = writeVerdict('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'uno.txt', line: 1 }])
    expect(judgeTask(v).stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('implement')

    // The implementer changes the code and the conductor obeys ONLY half the
    // message: it goes back to `next` (which regenerates the package from the
    // new index) and does NOT redispatch the judge — it hands in the file from
    // judging 1 all over again.
    writeFileSync(join(repo, 'uno.txt'), 'uno, una versión que ningún juez ha visto\n')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const r = ct('verdict', v)
    expect(r.status).toBe(0)                     // a discard, not a closure
    expect(r.stdout).toMatch(/veredicto descartado: el veredicto no es de este paquete/)
    expect(r.stdout).toContain('REDESPACHA al juez')
    expect(runState().step).toBe('judge')          // does NOT advance
    expect(runState().discards).toBe(1)            // and it counts towards MAX_DISCARDS
    expect(commits()).toBe(1)                    // the recycled verdict commits nothing

    // The TELEMETRY, which is where the failure was mute: the row of the
    // recycled one asserts neither a judging nor an input.
    const juez = judgeRows()
    expect(juez).toHaveLength(2)
    expect(juez[1].outcome).toBe('discarded')
    expect(juez[1].ruling).toBeUndefined()
    expect(juez[1].review_package).toBeUndefined()
    expect(juez[1].review_token).toBeUndefined()

    // And the honest path stays open: the judge is redispatched, and copies
    // the token of the NEW package.
    expect(judgeTask(writeVerdict('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
  })

  it('THE ATTACK (b): code changed in the gap left by the discard does not slip through with the old package', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    expect(ct('verdict', writeRaw('esto no es json')).stdout).toMatch(/veredicto descartado: no se pudo leer/)
    expect(existsSync(taskPackage())).toBe(true)   // the discard still does not consume

    // THE GAP: the implementer touches the file and RE-STAGES it. The `git
    // add` is the half that matters — `ct-step commit` commits the INDEX, so an
    // edit that is never staged does not reach the commit and invalidates no
    // judging.
    writeFileSync(join(repo, 'uno.txt'), 'uno, código que ningún juez ha visto\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })

    // The judge HONESTLY copies the token of the package it was given: it is
    // the one of the old code, and that is all it takes for it not to get
    // through.
    const r = ct('verdict', seal(writeVerdict('PASS'), taskPackage()))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto descartado: el paquete de revisión ya no describe el código de ahora/)
    expect(runState().step).toBe('judge')
    expect(runState().discards).toBe(2)
    expect(commits()).toBe(1)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
    const juez = judgeRows()
    expect(juez).toHaveLength(2)
    expect(juez[1].review_package).toBeUndefined()

    // The honest path: `next` regenerates the package from the index of NOW
    // and the PASS gets through over the code that is really going to be
    // committed.
    expect(judgeTask(writeVerdict('PASS')).stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
  })

  it('with a stale package AND unreadable JSON, the row tells the package: the cause rules over the symptom', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    writeFileSync(join(repo, 'uno.txt'), 'otra cosa\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    const r = ct('verdict', writeRaw('esto tampoco es json'))
    expect(r.stdout).toMatch(/ya no describe el código de ahora/)
    expect(r.stdout).not.toMatch(/no se pudo leer/)
    expect(judgeRows()[0].why).toMatch(/ya no describe el código de ahora/)
  })

  it('the legitimate retry over unreadable JSON still gets through without going via next', () => {
    // The same input, the same snapshot: the token matches and there is no
    // extra round trip. It is the property that makes NOT consuming on a
    // discard still worth it.
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const antes = readFileSync(taskPackage(), 'utf8')
    expect(ct('verdict', writeRaw('nada de json')).stdout).toMatch(/descartado/)
    expect(readFileSync(taskPackage(), 'utf8')).toBe(antes)
    const r = ct('verdict', seal(writeVerdict('PASS'), taskPackage()))
    expect(r.stdout).toMatch(/veredicto PASS/)
    expect(runState().discards).toBe(1)             // the retry did not spend a second discard
    expect(existsSync(taskPackage())).toBe(false)
  })

  // THE TOKEN IS WRITTEN BY THE PROGRAM. A verdict without the field was a
  // discard —of a whole opus verdict, and one of the six that kill the run— for
  // not having copied 64 hex characters from a line the program itself had just
  // written. Now it is accepted and the program fills in what it already knew.
  it('a verdict with no review_token is accepted: the program writes the token it computed itself', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const r = ct('verdict', writeVerdict('PASS'))    // nobody seals it: the judge does not write the token
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto PASS/)
    expect(runState().step).toBe('commit')
    expect(runState().discards ?? 0).toBe(0)
    // And what gets committed and what gets measured carry the token of the
    // package, just as when the judge copied it: the field is not lost, it
    // changes author.
    expect(judgeRows().at(-1).review_token).toMatch(/^[0-9a-f]{64}$/)
    const guardado = JSON.parse(readFileSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'), 'utf8'))
    expect(guardado.verdict.review_token).toBe(judgeRows().at(-1).review_token)
  })

  it('a verdict carrying the token of ANOTHER package is still discarded: the defence in depth is not touched', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const p = join(repo, 'ajeno.json')
    writeFileSync(p, JSON.stringify({ ruling: 'PASS', rubric: fullRubric(), findings: [], review_token: 'f'.repeat(64) }))
    const r = ct('verdict', p)
    expect(r.stdout).toMatch(/veredicto descartado: el veredicto no es de este paquete/)
    expect(runState().step).toBe('judge')
    expect(runState().discards).toBe(1)
  })

  it('a package with no token line (an older plugin, or an edited one) is discarded and sends you back to next', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const sinCabecera = readFileSync(taskPackage(), 'utf8').split('\n').filter((l) => !l.startsWith('Review token: ')).join('\n')
    writeFileSync(taskPackage(), sinCabecera)
    const r = ct('verdict', writeVerdict('PASS'))
    expect(r.stdout).toMatch(/no declara su "Review token"/)
    expect(runState().step).toBe('judge')
    expect(runState().discards).toBe(1)
    // And it heals in one round: `next` regenerates it WITH a token.
    expect(judgeTask(writeVerdict('PASS')).stdout).toMatch(/veredicto PASS/)
  })

  it('THE SLICE TWIN: the token comes out of the RANGE diff and travels in the committed verdict', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const token = packageToken(slicePackage())
    const diff = execFileSync('git', ['diff', '-U10', runState().baseSha, 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(token).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    const r = ct('slice-verdict', seal(writeSliceVerdict('PASS'), slicePackage()))
    expect(r.status).toBe(0)
    expect(runState().closed).toBe('delivered')
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-slice.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.review_token).toBe(token)
    expect(judgeRows('slice-judge').at(-1).review_token).toBe(token)
  })

  it('THE SLICE TWIN: a slice verdict with no review_token is accepted, and the committed token is the one of the package', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const token = packageToken(slicePackage())
    const r = ct('slice-verdict', writeSliceVerdict('PASS'))
    expect(r.status).toBe(0)
    expect(runState().closed).toBe('delivered')
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-slice.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.review_token).toBe(token)
  })

  it('THE SLICE TWIN: a slice verdict carrying the token of another package does not deliver the run', () => {
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    const p = join(repo, 'sv.json')
    writeFileSync(p, JSON.stringify({ ruling: 'PASS', rubric: sliceRubric(), findings: [], review_token: 'f'.repeat(64) }))
    const r = ct('slice-verdict', p)
    expect(r.stdout).toMatch(/veredicto de slice descartado: el veredicto no es de este paquete/)
    expect(runState().step).toBe('slice-judge')
    expect(runState().discards).toBe(1)
    expect(runState().closed ?? null).toBeNull()
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)
  })

  it('THE SLICE TWIN: a REWRITTEN commit in the gap left by the discard invalidates the package', () => {
    // The variant of (b) that the state's commit invariant does NOT catch: an
    // `--amend` leaves the count the same (`hechos === esperados`) and the
    // content different. Without the token, this gets through.
    taskOk('uno.txt'); taskOk('dos.txt'); ct('reconcile'); ct('global')
    ct('next')
    expect(ct('slice-verdict', writeRaw('ni json ni nada')).stdout).toMatch(/descartado/)
    writeFileSync(join(repo, 'dos.txt'), 'dos, reescrito después del juicio\n')
    execFileSync('git', ['add', 'dos.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], { cwd: repo })
    const r = ct('slice-verdict', seal(writeSliceVerdict('PASS'), slicePackage()))
    expect(r.stdout).toMatch(/ya no describe el código de ahora/)
    expect(runState().closed ?? null).toBeNull()
    expect(runState().step).toBe('slice-judge')
  })
})
