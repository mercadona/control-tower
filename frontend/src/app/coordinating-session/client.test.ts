import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'

const submission = () => ({
  id: StartPlanMother.TICKET,
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
      story: CoordinatingSessionMother.STORY,
      root: CoordinatingSessionMother.ROOT,
      session: CoordinatingSessionMother.SESSION,
      attention: { status: 'waiting', question: CoordinatingSessionMother.QUESTION },
      timeline: CoordinatingSessionMother.WAITING_TIMELINE,
      closureError: null,
    })
  })

  it('reads a live answer that names no story as unavailable, because the header could not say which story it is', async () => {
    const withoutStory = CoordinatingSessionMother.working().body.replace(`"story":"${CoordinatingSessionMother.STORY}",`, '')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(withoutStory, { status: 200 })))

    expect(await CoordinatingSessionClient.read()).toEqual({ kind: 'unavailable' })
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
      story: CoordinatingSessionMother.STORY,
      root: CoordinatingSessionMother.ROOT,
      detail: CoordinatingSessionMother.ENDED_DETAIL,
      timeline: CoordinatingSessionMother.WORKING_TIMELINE,
      closureError: null,
    })
  })

  it('sends exactly the ticket and the local path when it opens the brainstorming', async () => {
    const posting = vi.fn(async () => new Response(CoordinatingSessionMother.opened().body, { status: 202 }))
    vi.stubGlobal('fetch', posting)

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(posting).toHaveBeenCalledWith('/coordinating-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: StartPlanMother.REQUEST_BODY,
    })
    const [, init] = posting.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toStrictEqual({ id: StartPlanMother.TICKET, path: StartPlanMother.PATH })
    expect(outcome).toEqual({
      kind: 'opened',
      opened: {
        target: CoordinatingSessionMother.TARGET,
        conversation: CoordinatingSessionMother.CONVERSATION,
        repo: CoordinatingSessionMother.REPO,
        story: CoordinatingSessionMother.STORY,
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

  it('tells in Spanish that a story whose spec is frozen has finished its brainstorming', async () => {
    answerWith(CoordinatingSessionMother.storySpecFrozen())

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'story-spec-frozen',
      error: 'Este ticket ya tiene su spec congelado, así que su brainstorming ha terminado. Sigue con el groom.',
    })
  })

  it('tells in Spanish that the checkout has to be on the default branch to open a session', async () => {
    answerWith(CoordinatingSessionMother.checkoutOffTheDefaultBranch())

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'checkout-not-on-default-branch',
      error: 'La ruta local no está en la rama principal. Cámbiala a la rama principal y vuelve a abrir la sesión.',
    })
  })

  it('shows a protocol refusal as the backend wrote it, so the defect behind it can be traced', async () => {
    answerWith(CoordinatingSessionMother.bodyNotDeclaredAsJson())

    const outcome = await CoordinatingSessionClient.open(submission())

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'unsupported-media-type',
      error: 'the body must be declared as application/json',
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

  it('reopen posts the held target and adopts the session it answers', async () => {
    const posting = vi.fn(async () => new Response(CoordinatingSessionMother.opened().body, { status: 202 }))
    vi.stubGlobal('fetch', posting)

    const outcome = await CoordinatingSessionClient.reopen(CoordinatingSessionMother.TARGET)

    expect(posting).toHaveBeenCalledWith('/coordinating-session/reopen', {
      method: 'POST',
      headers: { 'x-coordinating-target': CoordinatingSessionMother.TARGET },
    })
    expect(outcome).toEqual({
      kind: 'opened',
      opened: {
        target: CoordinatingSessionMother.TARGET,
        conversation: CoordinatingSessionMother.CONVERSATION,
        repo: CoordinatingSessionMother.REPO,
        story: CoordinatingSessionMother.STORY,
        root: CoordinatingSessionMother.ROOT,
        session: CoordinatingSessionMother.SESSION,
      },
    })
  })

  it('reopen reads a refusal as product copy', async () => {
    answerWith({ status: 409, body: '{"code":"coordinating-session-not-ended","detail":"still live"}' })

    const outcome = await CoordinatingSessionClient.reopen(CoordinatingSessionMother.TARGET)

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'coordinating-session-not-ended',
      error: 'La sesión coordinadora sigue viva: no hace falta reabrirla.',
    })
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
