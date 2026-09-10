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
    { ...ProjectReadinessMother.report(), status: 'ready' },
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
})
