// ============================================================================
// The contract of the e2e report: the agent's JSON -> an OUTCOME the table
// consumes. A sibling of readVerdict/readReport, not a copy: same pattern
// (validate by hand, zero new dependencies), different content.
//
// WHAT IT CANNOT CHECK, AND IS SAID BECAUSE A STATED LIMIT IS OPERABLE: that
// the output is real. Nothing stops an agent from inventing a stdout — the same
// class of hole the plugin already acknowledges about the `-OK`. The only thing
// that bounds it is demanding a REPRODUCIBLE command: an invented output falls
// apart the moment somebody pastes it.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { readE2eReport } from '../scripts/step-contracts.js'
import { OUTCOMES } from '../scripts/run-machine.js'

const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'
const B = 'el example compila y sirve /metrics'

const verde = (run) => ({
  run, verdict: 'verde',
  brought_up: 'cargo run --example serve',
  evidence: [{ command: 'curl -sS -o /dev/null -w "%{http_code}" localhost:9115/metrics', output: '200' }],
})
const rojo = (run) => ({ run, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'que el puerto lo ocupe otro proceso' })
const sinVerificar = (run) => ({ run, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar', unblock: 'rellenar "Levantar" y "Listo cuando"' })

describe('readE2eReport', () => {
  it('all green → DONE', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs).toHaveLength(1)
  })

  it('one red → FAILED', () => {
    expect(readE2eReport({ runs: [rojo(A)] }, [A]).outcome).toBe(OUTCOMES.FAILED)
  })

  it('green + no-verificado → DONE, with the reason inside', () => {
    const r = readE2eReport({ runs: [verde(A), sinVerificar(B)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs.find((x) => x.run === B).reason).toMatch(/AGENTS\.md/)
  })

  it('structured absent or not an object → DISCARDED', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(readE2eReport(bad, [A]).outcome, JSON.stringify(bad)).toBe(OUTCOMES.DISCARDED)
    }
  })

  it('a traversal entry is missing → DISCARDED, even if the other one is green', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('one entry too many → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde(A), verde(B)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('a `run` that is not identical to the declared one → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde('el server escucha en 9115')] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('a verdict outside the three → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), verdict: 'ok' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('a green with no evidence → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), evidence: [] }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
    const sinSalida = { ...verde(A), evidence: [{ command: 'curl x', output: '' }] }
    expect(readE2eReport({ runs: [sinSalida] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('a no-verificado with neither reason nor unblock → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ run: A, verdict: 'no-verificado' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  // Finding 2 of the review of Task 8: a half-formed red was not discarded, and
  // `escribirInformeE2e` (ct-step.mjs) trusts that whatever reaches it here is
  // already validated — without this branch, a red missing one of its four
  // fields slipped a literal "undefined" into the pull request's markdown.
  it('a red missing one of the four fields that hold it up → DISCARDED', () => {
    for (const campo of ['expected', 'actual', 'repro', 'refuted_by']) {
      const incompleto = { ...rojo(A) }
      delete incompleto[campo]
      const r = readE2eReport({ runs: [incompleto] }, [A])
      expect(r.outcome, campo).toBe(OUTCOMES.DISCARDED)
    }
  })

  // §8.1 of the design: the evidence of an e2e is falsifiable, and its ONLY
  // declared mitigation is that the command be REPRODUCIBLE by a human ("an
  // invented output falls apart the moment somebody pastes it"). A green that
  // documents the `curl` but not how the system was brought up is NOT
  // reproducible: the mitigation evaporated exactly on the path that matters.
  it('a green with no `brought_up` → DISCARDED (with no how-it-was-brought-up, the evidence is not reproducible)', () => {
    const sin = { ...verde(A) }
    delete sin.brought_up
    const r = readE2eReport({ runs: [sin] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain('brought_up')
  })

  it('a red with no `brought_up` → DISCARDED, for the same reason', () => {
    const sin = { ...rojo(A) }
    delete sin.brought_up
    // DISCARDED and not FAILED: without the fields that hold it up, the entry
    // does not make it into `buenos`, so there is no red that can beat the
    // malformed one. It is the same treatment a red with no `expected` already
    // got.
    expect(readE2eReport({ runs: [sin] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  // And it is NOT demanded of a no-verificado, which is not a capricious
  // exception: the typical reason for that verdict is precisely that the system
  // could not be brought up.
  it('a no-verificado with no `brought_up` is still valid', () => {
    expect(readE2eReport({ runs: [sinVerificar(A)] }, [A]).outcome).toBe(OUTCOMES.DONE)
  })

  // Two identical cells are the SAME traversal. Without deduplicating, `find`
  // returned the same entry for both and `buenos` duplicated it —and with it
  // the markdown section that travels in the pull request—, while sending two
  // equal entries made the second fall into "an entry this slice does not
  // declare": the report had no correct way of being written at all.
  it('the same traversal declared twice collapses: one entry is enough, and it is not duplicated in `runs`', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A, A])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs).toHaveLength(1)
  })

  it('THE RED BEATS THE MALFORMED', () => {
    // A red says something about the PRODUCT; a broken format, about the
    // report. By emitting the discard first, the agent would fix the format,
    // retry and only THEN see the red: two rounds for a datum already in hand.
    const r = readE2eReport({ runs: [rojo(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.FAILED)
  })

  it('with no traversals declared this is not called, but if it is called it does not blow up', () => {
    expect(readE2eReport({ runs: [] }, []).outcome).toBe(OUTCOMES.DONE)
  })
})
