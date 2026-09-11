import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { ImplementHistoryClient } from 'app/implement-history/client'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const get = () => ImplementHistoryClient.get({
  issue: ImplementHistoryMother.ISSUE,
  root: ImplementHistoryMother.ROOT,
  repo: ImplementHistoryMother.REPO,
})

describe('ImplementHistoryClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should read an empty run as zero entries, not a refusal', async () => {
    answerWith(ImplementHistoryMother.empty())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'read', entries: [] })
  })

  it('should project every snake_case field of one finished step to camelCase', async () => {
    answerWith(ImplementHistoryMother.oneTask())

    const outcome = await get()

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
        summary: expect.any(String),
      }],
    })
  })

  it('should keep the step of a slice-wide row as null task and null task name', async () => {
    answerWith(ImplementHistoryMother.fullRun())

    const outcome = await get()

    expect(outcome.kind).toBe('read')
    const reconcile = outcome.kind === 'read' ? outcome.entries.find((entry) => entry.step === 'reconcile') : undefined
    expect(reconcile).toEqual({
      step: 'reconcile',
      task: null,
      taskName: null,
      tasksTotal: 2,
      attempt: 1,
      outcome: 'up-to-date',
      writtenAt: '2026-09-10T15:17:04.489Z',
      durationMs: 2055,
      summary: null,
    })
  })

  it('should treat a worktree without a metrics file yet as not read instead of a refusal', async () => {
    answerWith(ImplementHistoryMother.refusedNotRead())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'not-read' })
  })

  it('should keep the backend refusal text for a refusal other than not-read', async () => {
    answerWith(ImplementHistoryMother.refusedMalformedRepo())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'refused', error: ImplementHistoryMother.MALFORMED_REPO_DETAIL })
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of crashing on an unknown step', async () => {
    answerWith({ status: 200, body: '{"steps":[{"step":"unknown-step","task":1,"task_name":null,"tasks_total":1,"attempt":1,"outcome":"done","written_at":null,"duration_ms":null,"summary":null}]}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should ask with the issue in the path and the canonical root and the repository as query', async () => {
    const fetching = vi.fn(async () => new Response(ImplementHistoryMother.empty().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    await ImplementHistoryClient.get({ issue: 7, root: '/Users/pedro/code/name', repo: 'owner/name' })

    expect(fetching).toHaveBeenCalledWith(
      '/implement-history/7?root=%2FUsers%2Fpedro%2Fcode%2Fname&repo=owner%2Fname',
    )
  })
})
