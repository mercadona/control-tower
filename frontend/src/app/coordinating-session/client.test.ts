import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'

const submission = () => ({
  id: StartPlanMother.TICKET,
  repo: StartPlanMother.REPO,
  path: StartPlanMother.PATH,
})

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('CoordinatingSessionClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the coordinating session state', async () => {
    answerWith(CoordinatingSessionMother.waiting())

    const outcome = await CoordinatingSessionClient.read()

    expect(outcome).toEqual({
      kind: 'live',
      operation: 'idle',
      target: CoordinatingSessionMother.TARGET,
      conversation: CoordinatingSessionMother.CONVERSATION,
      repo: CoordinatingSessionMother.REPO,
      root: CoordinatingSessionMother.ROOT,
      session: CoordinatingSessionMother.SESSION,
      attention: { status: 'waiting', question: CoordinatingSessionMother.QUESTION },
      timeline: CoordinatingSessionMother.WAITING_TIMELINE,
      closureError: null,
    })
  })

  it('reads a conversation whose terminal exited as ended', async () => {
    answerWith(CoordinatingSessionMother.ended())

    const outcome = await CoordinatingSessionClient.read()

    expect(outcome).toEqual({
      kind: 'ended',
      operation: 'idle',
      target: CoordinatingSessionMother.TARGET,
      conversation: CoordinatingSessionMother.CONVERSATION,
      repo: CoordinatingSessionMother.REPO,
      root: CoordinatingSessionMother.ROOT,
      detail: CoordinatingSessionMother.ENDED_DETAIL,
      timeline: CoordinatingSessionMother.WORKING_TIMELINE,
      closureError: null,
    })
  })

  it('sends the idea when it opens the brainstorming', async () => {
    const posting = vi.fn(async () => new Response(CoordinatingSessionMother.opened().body, { status: 202 }))
    vi.stubGlobal('fetch', posting)

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(posting).toHaveBeenCalledWith('/coordinating-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: StartPlanMother.REQUEST_BODY,
    })
    expect(outcome).toEqual({
      kind: 'opened',
      opened: {
        target: CoordinatingSessionMother.TARGET,
        conversation: CoordinatingSessionMother.CONVERSATION,
        repo: CoordinatingSessionMother.REPO,
        root: CoordinatingSessionMother.ROOT,
        session: CoordinatingSessionMother.SESSION,
      },
    })
  })

  it("returns the backend's refusal with its code", async () => {
    answerWith(CoordinatingSessionMother.alreadyLive())

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'coordinating-session-already-live',
      error: 'Ya hay una sesión coordinadora en marcha.',
    })
  })

  it('closes only after a matching acknowledgement', async () => {
    const posting = vi.fn(async () => new Response(JSON.stringify({
      status: 'closed',
      conversation: CoordinatingSessionMother.CONVERSATION,
      target: CoordinatingSessionMother.TARGET,
    })))
    vi.stubGlobal('fetch', posting)

    const outcome = await CoordinatingSessionClient.close(
      CoordinatingSessionMother.CONVERSATION,
      CoordinatingSessionMother.TARGET,
    )

    expect(posting).toHaveBeenCalledWith('/coordinating-session/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: CoordinatingSessionMother.CONVERSATION,
        target: CoordinatingSessionMother.TARGET,
      }),
    })
    expect(outcome).toEqual({
      kind: 'closed',
      conversation: CoordinatingSessionMother.CONVERSATION,
      target: CoordinatingSessionMother.TARGET,
    })
  })

  it('does not accept a closure acknowledgement for another target', async () => {
    answerWith({
      status: 200,
      body: JSON.stringify({
        status: 'closed',
        conversation: CoordinatingSessionMother.CONVERSATION,
        target: 'fd40a5db-75bf-4a21-ae30-a1d601283e75',
      }),
    })

    await expect(CoordinatingSessionClient.close(
      CoordinatingSessionMother.CONVERSATION,
      CoordinatingSessionMother.TARGET,
    )).resolves.toEqual({ kind: 'backend-unreachable' })
  })

  it.each([
    ['wrong conversation', { status: 'closed', conversation: 'fd40a5db-75bf-4a21-ae30-a1d601283e75', target: CoordinatingSessionMother.TARGET }],
    ['wrong status', { status: 'closing', conversation: CoordinatingSessionMother.CONVERSATION, target: CoordinatingSessionMother.TARGET }],
  ])('rejects a close response with %s', async (_case, body) => {
    answerWith({ status: 200, body: JSON.stringify(body) })

    await expect(CoordinatingSessionClient.close(
      CoordinatingSessionMother.CONVERSATION,
      CoordinatingSessionMother.TARGET,
    )).resolves.toEqual({ kind: 'backend-unreachable' })
  })

  it('turns malformed opening and close bodies into transport uncertainty', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{', { status: 202 }))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    await expect(CoordinatingSessionClient.open(submission())).resolves.toEqual({ kind: 'backend-unreachable' })
    await expect(CoordinatingSessionClient.close(
      CoordinatingSessionMother.CONVERSATION,
      CoordinatingSessionMother.TARGET,
    )).resolves.toEqual({ kind: 'backend-unreachable' })
  })
})
