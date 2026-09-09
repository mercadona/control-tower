import { describe, it, expect } from 'vitest'
import { buildIssueBody, buildLabels, renderE2eContent, E2E_HEADING, GATES_HEADING } from '../scripts/groom.js'

const slice = (e2e) => ({
  n: 5, issue: null, name: 'exposición y exporter', type: 'backend',
  entrega: 'get_metrics y el router', gate: '–', deps: [],
  ac: ['un criterio'], protected: '', area: ['core'], touches: [], e2e,
})

describe('the ## E2E section of the issue body', () => {
  it('with journeys, it is emitted one per line and verbatim', () => {
    const body = buildIssueBody(slice('levantado con el example\\, curl -i :9115/metrics responde 200, el server escucha en 9115'), null)
    expect(body).toContain(E2E_HEADING)
    expect(body).toContain('- levantado con el example, curl -i :9115/metrics responde 200')
    expect(body).toContain('- el server escucha en 9115')
  })

  it('with `no`, the section is NOT emitted', () => {
    expect(buildIssueBody(slice('no'), null)).not.toContain(E2E_HEADING)
  })

  it('with no column at all, the section is NOT emitted', () => {
    expect(buildIssueBody(slice(''), null)).not.toContain(E2E_HEADING)
  })

  it('the section goes AFTER ## Gates', () => {
    const body = buildIssueBody(slice('un recorrido'), null)
    expect(body.indexOf(E2E_HEADING)).toBeGreaterThan(body.indexOf(GATES_HEADING))
  })

  it('with journeys, the gate:e2e label is emitted', () => {
    expect(buildLabels(slice('un recorrido'))).toContain('gate:e2e')
  })

  it('with `no`, the gate:e2e label is NOT emitted', () => {
    expect(buildLabels(slice('no'))).not.toContain('gate:e2e')
  })

  it('renderE2eContent is the single source of truth of the content', () => {
    expect(renderE2eContent(slice('uno, dos'))).toBe('- uno\n- dos')
  })
})

// The worked example that fixes the real proportion, and that is the argument
// behind the whole design: if this produced one e2e per slice, an epic of 8
// would give 6 filler reports — the surest way for nobody to read the seventh.
// Measured by hand over mo-monitoring v1 applying the criterion "does the
// system have to be up?".
describe('mo-monitoring v1 as a worked example', () => {
  const filas = [
    { n: 1, name: 'esqueleto', type: 'infra', e2e: 'no' },
    { n: 2, name: 'modelo y environment', type: 'backend', e2e: 'no' },
    { n: 3, name: 'repositorio prometheus', type: 'backend', e2e: 'no' },
    { n: 4, name: 'summary collector', type: 'backend', e2e: 'no' },
    { n: 5, name: 'exposición y exporter', type: 'backend', e2e: 'levantado con el example\\, curl -i :9115/metrics responde 200 con content type text/plain; version=0.0.4' },
    { n: 6, name: 'logging JSON', type: 'backend', e2e: 'no' },
    { n: 7, name: 'instrument y guard', type: 'backend', e2e: 'no' },
    { n: 8, name: 'golden tests de paridad', type: 'backend', e2e: 'el example compila con cargo build --examples y sirve /metrics' },
  ].map((f) => ({ ...f, issue: null, entrega: '', gate: '–', deps: [], ac: ['x'], protected: '', area: ['core'], touches: [] }))

  it('exactly 2 out of 8 produce gate:e2e', () => {
    const conE2e = filas.filter((f) => buildLabels(f).includes('gate:e2e'))
    expect(conE2e.map((f) => f.n)).toEqual([5, 8])
  })

  it('the 6 with `no` emit no ## E2E section', () => {
    for (const f of filas.filter((f) => f.e2e === 'no')) {
      expect(buildIssueBody(f, null), `slice #${f.n}`).not.toContain(E2E_HEADING)
    }
  })
})
