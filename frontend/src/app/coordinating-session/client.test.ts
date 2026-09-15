import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'

const submission = () => ({
  id: StartPlanMother.TICKET,
  userComment: null,
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
      conversation: CoordinatingSessionMother.CONVERSATION,
      repo: CoordinatingSessionMother.REPO,
      root: CoordinatingSessionMother.ROOT,
      session: CoordinatingSessionMother.SESSION,
      attention: { status: 'waiting', question: CoordinatingSessionMother.QUESTION },
    })
  })

  it('reads a conversation whose terminal exited as ended', async () => {
    answerWith(CoordinatingSessionMother.ended())

    const outcome = await CoordinatingSessionClient.read()

    expect(outcome).toEqual({
      kind: 'ended',
      conversation: CoordinatingSessionMother.CONVERSATION,
      detail: CoordinatingSessionMother.ENDED_DETAIL,
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
        conversation: CoordinatingSessionMother.CONVERSATION,
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
      error: CoordinatingSessionMother.ALREADY_LIVE_DETAIL,
    })
  })
})
