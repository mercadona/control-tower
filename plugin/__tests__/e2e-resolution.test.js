// ============================================================================
// The THREE states of the E2E cell, and why there are three and not two.
//
// An empty cell would mean two incompatible things: (a) it was thought about
// and this slice has nothing to walk through, and (b) nobody filled the column
// in. Same outcome, indistinguishable — and with (b) the feature ends up inert
// without anyone noticing. It is the ambiguity GATE_LABEL_NONE already
// resolved for the twin case, with one difference that decides the design:
// gate:none is DERIVED by the plugin, and here only whoever writes the spec
// knows the distinction. There is no way to derive it, so it is declared.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { resolveE2e, resolveGates, GATES, gateLabels, gatesFromLabels } from '../scripts/gates.js'

describe('resolveE2e — the three states', () => {
  it('runs: declared, with e2e', () => {
    const r = resolveE2e('levantado con el example\\, curl -i :9115/metrics responde 200')
    expect(r.runs).toEqual(['levantado con el example, curl -i :9115/metrics responde 200'])
    expect(r.declared).toBe(true)
    expect(r.none).toBe(false)
    expect(r.contradiction).toBe(false)
  })

  it('two runs separated by an unescaped comma are two', () => {
    expect(resolveE2e('recorrido uno, recorrido dos').runs).toEqual(['recorrido uno', 'recorrido dos'])
  })

  it('the `no` token is declared and with no e2e', () => {
    for (const cell of ['no', 'NO', ' no ', '`no`', '**no**', 'n/a', 'N/A']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(true)
      expect(r.none, cell).toBe(true)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('a no-value marker is NOT DECLARED, not a `no`', () => {
    for (const cell of ['', '-', '–', '—', '―', '−', '--', '   ']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(false)
      expect(r.none, cell).toBe(false)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('a run that STARTS with "no" is a run, not the token', () => {
    const r = resolveE2e('no se puede acceder a /metrics sin levantar el server')
    expect(r.none).toBe(false)
    expect(r.runs).toEqual(['no se puede acceder a /metrics sin levantar el server'])
  })

  it('the token alongside a run is a contradiction', () => {
    const r = resolveE2e('no, curl -i :9115/metrics responde 200')
    expect(r.contradiction).toBe(true)
    expect(r.declared).toBe(true)
  })

  it('an empty run between commas is silently discarded', () => {
    expect(resolveE2e('uno,, dos').runs).toEqual(['uno', 'dos'])
  })
})

describe('the derived e2e gate', () => {
  it('with runs, resolveGates adds e2e', () => {
    expect(resolveGates('backend', '–', 'curl -i :9115/metrics').gates).toEqual(['e2e'])
  })

  it('with the `no` token, it does not add it', () => {
    expect(resolveGates('backend', '–', 'no').gates).toEqual([])
  })

  it('with no E2E cell (third argument absent), the behaviour is the one of today', () => {
    expect(resolveGates('ui', '–').gates).toEqual(['visual'])
    expect(resolveGates('backend', '–').gates).toEqual([])
  })

  it('no Tipo implies e2e on its own', () => {
    for (const t of ['ui', 'infra', 'backend', '']) {
      expect(resolveGates(t, '–', '–').gates, t).not.toContain('e2e')
    }
  })

  it('e2e goes LAST in the canonical order', () => {
    expect(resolveGates('ui', 'apply, plan', 'un recorrido').gates).toEqual(['visual', 'apply', 'plan', 'e2e'])
  })

  it('the vocabulary includes e2e with its two texts', () => {
    expect(Object.keys(GATES)).toEqual(['visual', 'apply', 'plan', 'e2e'])
    expect(GATES.e2e.kickoff).toMatch(/## E2E/)
    expect(GATES.e2e.kickoff).toMatch(/AGENTS\.md/)
    expect(GATES.e2e.issue).toMatch(/e2e/)
  })

  // The channel through which the gate SURVIVES: /ct-next rebuilds the slice
  // it dispatches out of the ISSUE, so a gate that does not come back from its
  // labels is lost on a redispatch, on a --reopen and after a /clear.
  it('the label survives the round trip', () => {
    const gates = resolveGates('ui', '–', 'un recorrido').gates
    const labels = gateLabels(gates)
    expect(labels).toEqual(['gate:visual', 'gate:e2e'])
    const back = gatesFromLabels(labels)
    expect(back.gates).toEqual(gates)
    expect(back.declared).toBe(true)
    expect(back.unknown).toEqual([])
  })
})
