import { ImplementHistoryClient } from 'app/implement-history/client'

const DOCUMENTED_ANSWER =
  '{"steps":[{"step":"implement","task":1,"task_name":"the lookup looks where it says it looks",' +
  '"tasks_total":2,"attempt":1,"outcome":"done","written_at":"2026-09-10T14:55:59.885Z",' +
  '"duration_ms":null,"summary":"Renamed ..."}]}'

describe('the wire shape backend/API.md documents for GET /implement-history/:issue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should read the documented answer as one entry with all nine fields projected to camelCase, because a backend rename to any of them arrives here as a red test', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(DOCUMENTED_ANSWER, { status: 200 })))

    const outcome = await ImplementHistoryClient.get({ issue: 7, root: '/repo/checkout', repo: 'owner/name' })

    expect(outcome).toEqual({
      kind: 'read',
      entries: [{
        step: 'implement',
        task: 1,
        taskName: 'the lookup looks where it says it looks',
        tasksTotal: 2,
        attempt: 1,
        outcome: 'done',
        writtenAt: '2026-09-10T14:55:59.885Z',
        durationMs: null,
        summary: 'Renamed ...',
      }],
    })
  })

  it('should read a worktree with no metrics file yet as an empty run, not a refusal, because docs/superpowers/metrics/issue-<n>.jsonl not existing means nothing ran there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"steps":[]}', { status: 200 })))

    const outcome = await ImplementHistoryClient.get({ issue: 7, root: '/repo/checkout', repo: 'owner/name' })

    expect(outcome).toEqual({ kind: 'read', entries: [] })
  })

  it('should treat implementation-history-not-read as keep polling, the same refusal code backend/API.md documents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"implementation-history-not-read","detail":"the metrics file could not be read"}', { status: 400 })),
    )

    const outcome = await ImplementHistoryClient.get({ issue: 7, root: '/repo/checkout', repo: 'owner/name' })

    expect(outcome).toEqual({ kind: 'not-read' })
  })
})
