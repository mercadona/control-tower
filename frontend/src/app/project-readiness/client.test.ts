import { ProjectReadinessClient } from './client'
import { ProjectReadinessMother } from '__scenarios__/ProjectReadinessMother'

describe('ProjectReadinessClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests_only_inspection_of_the_selected_target', async () => {
    const fetcher = vi.fn(async () => ProjectReadinessMother.response())
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const result = await ProjectReadinessClient.inspect('owner/project', '/repo', controller.signal)
    expect(result.kind).toBe('inspected')
    expect(fetcher).toHaveBeenCalledWith('/project-readiness', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', path: '/repo' }), signal: controller.signal,
    })
  })

  it.each([
    { ...ProjectReadinessMother.report(), status: 'unexpected' },
    { ...ProjectReadinessMother.report(), repo: 'other/project' },
    { ...ProjectReadinessMother.report(), findings: [] },
    { ...ProjectReadinessMother.report(), findings: [{ id: 'new-check', status: 'ready', evidence: [], action: null }] },
    { ...ProjectReadinessMother.report(), certified: true },
  ])('refuses_an_inconsistent_or_unknown_payload: %j', async (report) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(report))))
    expect(await ProjectReadinessClient.inspect('owner/project', '/repo', new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('does_not_turn_a_transport_failure_into_a_ready_report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await ProjectReadinessClient.inspect('owner/project', '/repo', new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('uses_the_backends_classification_without_reimplementing_its_precedence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...ProjectReadinessMother.report(), status: 'ready' }))))
    const result = await ProjectReadinessClient.inspect('owner/project', '/repo', new AbortController().signal)
    expect(result).toMatchObject({ kind: 'inspected', status: 'ready' })
  })

  it('constructs_an_owned_immutable_report_instead_of_returning_the_wire_record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ProjectReadinessMother.response()))
    const result = await ProjectReadinessClient.inspect('owner/project', '/repo', new AbortController().signal)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result).toMatchObject({ kind: 'inspected', baseRevision: 'a'.repeat(40), observedAt: '2026-09-10T00:00:00.000Z' })
    expect(result).not.toHaveProperty('base_revision')
    if (result.kind === 'inspected') {
      expect(Object.isFrozen(result.findings)).toBe(true)
      expect(Object.isFrozen(result.findings[0])).toBe(true)
      expect(Object.isFrozen(result.findings[0].evidence)).toBe(true)
    }
  })
})
