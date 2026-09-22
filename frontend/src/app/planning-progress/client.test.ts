import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { PlanningProgressClient } from 'app/planning-progress/client'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const get = () => PlanningProgressClient.get({
  issue: PlanningProgressMother.ISSUE,
  repo: PlanningProgressMother.REPO,
})

describe('PlanningProgressClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should read the state, the running time, the tool calls, the last tool and the last text of a run in progress', async () => {
    answerWith(PlanningProgressMother.running())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      activity: {
        state: 'running',
        runningMs: 372000,
        toolCalls: 41,
        lastTool: { name: 'Read', argument: 'plugin/conventions/testing.md' },
        lastText: 'Ahora escribo el plan',
      },
    })
  })

  it('should keep the last tool and the last text as null before the agent has produced either', async () => {
    answerWith(PlanningProgressMother.runningBeforeTheFirstToolCall())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      activity: { state: 'running', runningMs: 1500, toolCalls: 0, lastTool: null, lastText: null },
    })
  })

  it('should read a finished run the same way as a running one', async () => {
    answerWith(PlanningProgressMother.finished())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      activity: {
        state: 'finished',
        runningMs: 614000,
        toolCalls: 57,
        lastTool: { name: 'Write', argument: 'docs/plan-500.md' },
        lastText: 'El plan queda escrito.',
      },
    })
  })

  it('should treat this process not watching the issue as its own outcome instead of a generic refusal', async () => {
    answerWith(PlanningProgressMother.notWatched())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'not-watched' })
  })

  it('should treat the conversation having no recorded planning call yet as its own outcome instead of a generic refusal', async () => {
    answerWith(PlanningProgressMother.notRead())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'not-read' })
  })

  it('should keep the backend refusal text for a malformed request', async () => {
    answerWith(PlanningProgressMother.malformedRepo())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'refused', error: PlanningProgressMother.MALFORMED_REPO_DETAIL })
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of guessing when last_tool is missing entirely', async () => {
    answerWith({ status: 200, body: '{"state":"running","running_ms":1,"tool_calls":1,"last_text":null}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of guessing when last_tool has a malformed name', async () => {
    answerWith({ status: 200, body: '{"state":"running","running_ms":1,"tool_calls":1,"last_tool":{"name":42,"argument":null},"last_text":null}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of guessing when last_tool is a bare string', async () => {
    answerWith({ status: 200, body: '{"state":"running","running_ms":1,"tool_calls":1,"last_tool":"Read","last_text":null}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of crashing on an unknown state', async () => {
    answerWith({ status: 200, body: '{"state":"unknown-state","running_ms":1,"tool_calls":0,"last_tool":null,"last_text":null}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should ask with the issue in the path and the repository as query', async () => {
    const fetching = vi.fn(async () => new Response(PlanningProgressMother.running().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    await PlanningProgressClient.get({ issue: 7, repo: 'owner/name' })

    expect(fetching).toHaveBeenCalledWith('/planning-progress/7?repo=owner%2Fname')
  })
})
