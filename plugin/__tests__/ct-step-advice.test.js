// H9 — the `advise` step, between the SECOND veto and the THIRD attempt. The
// preamble —and why this is several files and not one— is in
// fixtures/ct-step-harness.js.
//
// What this file measures is the advisor-strategy pattern exactly as the loop
// applies it: that the second failure over the same problem ESCALATES to an
// advisor of a higher tier instead of blindly repeating the same attempt, that
// its answer is validated against a schema, and that an unreadable piece of
// advice does not cost the task the one attempt it has left.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'
import { ADVISOR_TOOLS, ADVICE_PACKAGE_SECTIONS } from '../scripts/step-contracts.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, runState, judgeTask, judgeRows } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

const FINDING = { severity: 'high', what: 'la lógica está en el sitio que no es', path: 'uno.txt', line: 1 }

// A whole attempt that ends in a veto, with what the implementer said about it:
// it is what the advisor's package has to be able to show afterwards.
const vetoedAttempt = (says) => {
  ct('next')
  ct('report', writeReport(['uno.txt'], 'report.json', says))
  ct('controls')
  return judgeTask(writeVerdict('FAIL', [FINDING]))
}

const twoVetoes = () => {
  vetoedAttempt('lo puse en el módulo viejo')
  vetoedAttempt('lo volví a poner en el módulo viejo')
}

const advice = (over = {}, name = 'advice.json') => {
  const p = join(repo, name)
  const body = { approach: 'saca la decisión a un tipo propio y prueba por ahí', files_to_reconsider: ['uno.txt'], ...over }
  for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k]
  writeFileSync(p, JSON.stringify(body))
  return p
}

const advicePackagePath = () => join(repo, '.agent', 'run-7', `task-${runState().task}-advice.md`)

// `next` is the only verb that writes the advisor's package, the same as with
// the judge: asking for the advice is, by definition, having asked before.
const askForAdvice = (...args) => { ct('next'); return ct('advice', ...args) }

describe('the second veto does not go back to implementing blindly', () => {
  it('after two vetoes the step is advise, and next orders dispatching the advisor and not an implementer', () => {
    twoVetoes()

    expect(runState().step).toBe('advise')
    const r = ct('next')
    expect(r.stdout).toMatch(/DESPACHA EL CONSEJERO/)
    expect(r.stdout).toContain('ct-advisor')
    expect(r.stdout).toContain(ADVISOR_TOOLS)
    expect(r.stdout).not.toMatch(/DESPACHA UN IMPLEMENTADOR/)
  })

  it('the attempt is still the third: advise does not start a counter of its own', () => {
    twoVetoes()

    expect(runState().judgeRetries).toBe(2)
    expect(ct('next').stdout).toMatch(/paso: advise \(intento 3\)/)
  })

  it("the advisor's package carries the brief, the two attempts and the two verdicts", () => {
    twoVetoes()

    ct('next')
    const packageText = readFileSync(advicePackagePath(), 'utf8')
    for (const section of ADVICE_PACKAGE_SECTIONS) expect(packageText).toContain(`## ${section}`)
    expect(packageText).toContain('lo puse en el módulo viejo')
    expect(packageText).toContain('lo volví a poner en el módulo viejo')
    expect(packageText).toContain('la lógica está en el sitio que no es')
    // The task's brief, which the two attempts came out of.
    expect(packageText).toContain('the first one')
  })

  it('asking for the advice outside its step is refused with a 9, like any other verb', () => {
    const r = ct('advice', advice())

    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(/no es el paso que toca/)
  })
})

describe('advice that does not meet the schema does not spend the attempt that is left', () => {
  it('advice with no approach is discarded, counts as a discard and NOT as a retry', () => {
    twoVetoes()

    const r = askForAdvice(advice({ approach: undefined }))

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(runState().step).toBe('advise')
    expect(runState().discards).toBe(1)
    expect(runState().judgeRetries).toBe(2)
  })

  it('JSON that does not parse is a discard too and the question is asked again', () => {
    twoVetoes()

    askForAdvice(writeRaw('esto no es json'))

    expect(runState().step).toBe('advise')
    expect(runState().discards).toBe(1)
  })

  it('advice issued with no package is not advice: the advisor advised blindly', () => {
    twoVetoes()
    ct('next')
    rmSync(advicePackagePath())

    const r = ct('advice', advice())

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(runState().discards).toBe(1)
  })

  it('discarding without end is cut off with a 3 instead of going on asking', () => {
    twoVetoes()
    let r
    for (let i = 0; i < 7; i++) r = askForAdvice(writeRaw('nada'))

    expect(r.status).toBe(3)
  })
})

describe('the accepted advice opens the third attempt', () => {
  it('done → implement, with the advice saved in the state', () => {
    twoVetoes()

    const r = askForAdvice(advice())

    expect(r.status).toBe(0)
    expect(runState().step).toBe('implement')
    expect(runState().lastAdvice.approach).toMatch(/saca la decisión a un tipo propio/)
  })

  it('the third veto no longer consults anybody: it closes in blocked-judge with a 1', () => {
    twoVetoes()
    askForAdvice(advice())

    const r = vetoedAttempt('lo intenté por el camino que dijo el consejero')

    expect(r.status).toBe(1)
    expect(runState().step).toBe('judge')
  })
})

// AC 2 and 3 of the issue: the third attempt does not start on top of the two
// earlier ones, and it does not start without the advice.
describe('the third attempt starts with a clean tree and with the advice in front of it', () => {
  // What is looked at is the state of the paths OF THE TASK: the run's file, its
  // folder and the machinery stay untracked on purpose, and counting them here
  // would measure the scaffolding instead of the tree the third attempt
  // inherits.
  const gitStatus = (...paths) =>
    execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: repo, encoding: 'utf8' })

  it("the tree goes back to the last commit for the task's paths", () => {
    twoVetoes()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')
    writeFileSync(join(repo, 'sobra.txt'), 'un fichero que el segundo intento se inventó')

    askForAdvice(advice())

    expect(gitStatus('uno.txt', 'sobra.txt')).toBe('')
    expect(existsSync(join(repo, 'sobra.txt'))).toBe(false)
  })

  it("what it cleans is the task's paths: the run's file and its folder are still there", () => {
    twoVetoes()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')

    askForAdvice(advice())

    expect(existsSync(join(repo, '.agent', 'run-7.json'))).toBe(true)
    expect(existsSync(advicePackagePath())).toBe(true)
    expect(runState().step).toBe('implement')
  })

  it("the brief of the third attempt carries the advisor's approach inside it", () => {
    twoVetoes()
    askForAdvice(advice())

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toContain('saca la decisión a un tipo propio')
    expect(brief).toContain('uno.txt')
  })

  it('the advice is not inherited: the next task starts a brief without it', () => {
    twoVetoes()
    askForAdvice(advice())
    ct('next')
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    ct('commit')

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-2-brief.md'), 'utf8')
    expect(brief).not.toContain('saca la decisión a un tipo propio')
  })
})

describe('what the advice leaves measured', () => {
  it('the row of the advise step says how much the advice weighed and how it ended', () => {
    twoVetoes()
    askForAdvice(advice())

    const [row] = judgeRows('advise')
    expect(row.outcome).toBe('done')
    expect(row.advice_bytes).toBeGreaterThan(0)
    expect(row.task).toBe(1)
    expect(row.attempt).toBe(3)
    // The material of the role, as in any other step that dispatches somebody.
    expect(row.agent_bytes).toBeGreaterThan(0)
    expect(row.package_bytes).toBeGreaterThan(0)
  })

  it('discarded advice leaves a row too, with the reason and without claiming a size it did not measure', () => {
    twoVetoes()
    askForAdvice(writeRaw('nada'))

    const [row] = judgeRows('advise')
    expect(row.outcome).toBe('discarded')
    expect(row.why).toMatch(/no se pudo leer/)
  })
})

describe('the advisor cannot be left without what it was promised', () => {
  it('the dispatch seal covers advise: without going through next, the guard refuses it', () => {
    twoVetoes()

    ct('next')
    expect(runState().nextSeal).toBe('1:advise:3')
  })

  it('the package survives a discard: it does not have to be regenerated to ask again', () => {
    twoVetoes()
    ct('next')
    ct('advice', writeRaw('nada'))

    expect(existsSync(advicePackagePath())).toBe(true)
  })
})
