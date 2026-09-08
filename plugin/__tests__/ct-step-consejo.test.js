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

const HALLAZGO = { severity: 'high', what: 'la lógica está en el sitio que no es', path: 'uno.txt', line: 1 }

// A whole attempt that ends in a veto, with what the implementer said about it:
// it is what the advisor's package has to be able to show afterwards.
const intentoVetado = (dice) => {
  ct('next')
  ct('report', writeReport(['uno.txt'], 'report.json', dice))
  ct('controls')
  return judgeTask(writeVerdict('FAIL', [HALLAZGO]))
}

const dosVetos = () => {
  intentoVetado('lo puse en el módulo viejo')
  intentoVetado('lo volví a poner en el módulo viejo')
}

const consejo = (over = {}, nombre = 'advice.json') => {
  const p = join(repo, nombre)
  const cuerpo = { approach: 'saca la decisión a un tipo propio y prueba por ahí', files_to_reconsider: ['uno.txt'], ...over }
  for (const [k, v] of Object.entries(cuerpo)) if (v === undefined) delete cuerpo[k]
  writeFileSync(p, JSON.stringify(cuerpo))
  return p
}

const paqueteDeConsejo = () => join(repo, '.agent', 'run-7', `task-${runState().task}-advice.md`)

// `next` is the only verb that writes the advisor's package, the same as with
// the judge: asking for the advice is, by definition, having asked before.
const aconsejar = (...args) => { ct('next'); return ct('advice', ...args) }

describe('the second veto does not go back to implementing blindly', () => {
  it('after two vetoes the step is advise, and next orders dispatching the advisor and not an implementer', () => {
    dosVetos()

    expect(runState().step).toBe('advise')
    const r = ct('next')
    expect(r.stdout).toMatch(/DESPACHA EL CONSEJERO/)
    expect(r.stdout).toContain('ct-advisor')
    expect(r.stdout).toContain(ADVISOR_TOOLS)
    expect(r.stdout).not.toMatch(/DESPACHA UN IMPLEMENTADOR/)
  })

  it('the attempt is still the third: advise does not start a counter of its own', () => {
    dosVetos()

    expect(runState().judgeRetries).toBe(2)
    expect(ct('next').stdout).toMatch(/paso: advise \(intento 3\)/)
  })

  it("the advisor's package carries the brief, the two attempts and the two verdicts", () => {
    dosVetos()

    ct('next')
    const paquete = readFileSync(paqueteDeConsejo(), 'utf8')
    for (const seccion of ADVICE_PACKAGE_SECTIONS) expect(paquete).toContain(`## ${seccion}`)
    expect(paquete).toContain('lo puse en el módulo viejo')
    expect(paquete).toContain('lo volví a poner en el módulo viejo')
    expect(paquete).toContain('la lógica está en el sitio que no es')
    // The task's brief, which the two attempts came out of.
    expect(paquete).toContain('the first one')
  })

  it('asking for the advice outside its step is refused with a 9, like any other verb', () => {
    const r = ct('advice', consejo())

    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(/no es el paso que toca/)
  })
})

describe('advice that does not meet the schema does not spend the attempt that is left', () => {
  it('advice with no approach is discarded, counts as a discard and NOT as a retry', () => {
    dosVetos()

    const r = aconsejar(consejo({ approach: undefined }))

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(runState().step).toBe('advise')
    expect(runState().discards).toBe(1)
    expect(runState().judgeRetries).toBe(2)
  })

  it('JSON that does not parse is a discard too and the question is asked again', () => {
    dosVetos()

    aconsejar(writeRaw('esto no es json'))

    expect(runState().step).toBe('advise')
    expect(runState().discards).toBe(1)
  })

  it('advice issued with no package is not advice: the advisor advised blindly', () => {
    dosVetos()
    ct('next')
    rmSync(paqueteDeConsejo())

    const r = ct('advice', consejo())

    expect(r.stdout).toMatch(/consejo descartado/)
    expect(runState().discards).toBe(1)
  })

  it('discarding without end is cut off with a 3 instead of going on asking', () => {
    dosVetos()
    let r
    for (let i = 0; i < 7; i++) r = aconsejar(writeRaw('nada'))

    expect(r.status).toBe(3)
  })
})

describe('the accepted advice opens the third attempt', () => {
  it('done → implement, with the advice saved in the state', () => {
    dosVetos()

    const r = aconsejar(consejo())

    expect(r.status).toBe(0)
    expect(runState().step).toBe('implement')
    expect(runState().lastAdvice.approach).toMatch(/saca la decisión a un tipo propio/)
  })

  it('the third veto no longer consults anybody: it closes in blocked-judge with a 1', () => {
    dosVetos()
    aconsejar(consejo())

    const r = intentoVetado('lo intenté por el camino que dijo el consejero')

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
  const estadoDeGit = (...rutas) =>
    execFileSync('git', ['status', '--porcelain', '--', ...rutas], { cwd: repo, encoding: 'utf8' })

  it("the tree goes back to the last commit for the task's paths", () => {
    dosVetos()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')
    writeFileSync(join(repo, 'sobra.txt'), 'un fichero que el segundo intento se inventó')

    aconsejar(consejo())

    expect(estadoDeGit('uno.txt', 'sobra.txt')).toBe('')
    expect(existsSync(join(repo, 'sobra.txt'))).toBe(false)
  })

  it("what it cleans is the task's paths: the run's file and its folder are still there", () => {
    dosVetos()
    writeFileSync(join(repo, 'uno.txt'), 'lo que dejó el segundo intento')

    aconsejar(consejo())

    expect(existsSync(join(repo, '.agent', 'run-7.json'))).toBe(true)
    expect(existsSync(paqueteDeConsejo())).toBe(true)
    expect(runState().step).toBe('implement')
  })

  it("the brief of the third attempt carries the advisor's approach inside it", () => {
    dosVetos()
    aconsejar(consejo())

    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toContain('saca la decisión a un tipo propio')
    expect(brief).toContain('uno.txt')
  })

  it('the advice is not inherited: the next task starts a brief without it', () => {
    dosVetos()
    aconsejar(consejo())
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
    dosVetos()
    aconsejar(consejo())

    const [fila] = judgeRows('advise')
    expect(fila.outcome).toBe('done')
    expect(fila.advice_bytes).toBeGreaterThan(0)
    expect(fila.task).toBe(1)
    expect(fila.attempt).toBe(3)
    // The material of the role, as in any other step that dispatches somebody.
    expect(fila.agent_bytes).toBeGreaterThan(0)
    expect(fila.package_bytes).toBeGreaterThan(0)
  })

  it('discarded advice leaves a row too, with the reason and without claiming a size it did not measure', () => {
    dosVetos()
    aconsejar(writeRaw('nada'))

    const [fila] = judgeRows('advise')
    expect(fila.outcome).toBe('discarded')
    expect(fila.why).toMatch(/no se pudo leer/)
  })
})

describe('the advisor cannot be left without what it was promised', () => {
  it('the dispatch seal covers advise: without going through next, the guard refuses it', () => {
    dosVetos()

    ct('next')
    expect(runState().nextSeal).toBe('1:advise:3')
  })

  it('the package survives a discard: it does not have to be regenerated to ask again', () => {
    dosVetos()
    ct('next')
    ct('advice', writeRaw('nada'))

    expect(existsSync(paqueteDeConsejo())).toBe(true)
  })
})
