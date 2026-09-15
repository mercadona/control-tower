import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { EpicGroomClient } from 'app/epic-groom/client'

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('EpicGroomClient, against the wire shapes backend/API.md documents for GET /epic-groom, POST /epic-groom and POST /epic-promotion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a groomable body with no key reads as a state with no key rather than as unavailable', async () => {
    answerWith(EpicGroomMother.groomableWithoutKey())

    const outcome = await EpicGroomClient.read()

    expect(outcome).toEqual({
      kind: 'groomable',
      milestone: EpicGroomMother.MILESTONE,
      plan: [EpicGroomMother.GATE_ISSUE, EpicGroomMother.CHANNEL_ISSUE],
      planFingerprint: EpicGroomMother.PLAN_FINGERPRINT,
      key: null,
    })
  })

  it('each of the nine states is read as its own kind', async () => {
    const cases: Array<[{ status: number; body: string }, unknown]> = [
      [EpicGroomMother.none(), { kind: 'none' }],
      [EpicGroomMother.noSpec(), { kind: 'no-spec' }],
      [EpicGroomMother.draft(), { kind: 'draft' }],
      [EpicGroomMother.awaitingPublication(), { kind: 'awaiting-publication' }],
      [
        EpicGroomMother.issuesUncertain(),
        { kind: 'issues-uncertain', milestone: EpicGroomMother.MILESTONE, reason: EpicGroomMother.ISSUES_UNCERTAIN_REASON },
      ],
      [
        EpicGroomMother.groomable(),
        {
          kind: 'groomable',
          milestone: EpicGroomMother.MILESTONE,
          plan: [EpicGroomMother.GATE_ISSUE, EpicGroomMother.CHANNEL_ISSUE],
          planFingerprint: EpicGroomMother.PLAN_FINGERPRINT,
          key: EpicGroomMother.KEY,
        },
      ],
      [
        EpicGroomMother.partiallyGroomed(),
        {
          kind: 'partially-groomed',
          milestone: EpicGroomMother.MILESTONE,
          plan: [EpicGroomMother.GATE_ISSUE, EpicGroomMother.CHANNEL_ISSUE],
          planFingerprint: EpicGroomMother.PLAN_FINGERPRINT,
          issues: [EpicGroomMother.BACKLOG_GATE],
          key: EpicGroomMother.KEY,
        },
      ],
      [
        EpicGroomMother.groomed(),
        {
          kind: 'groomed',
          milestone: EpicGroomMother.MILESTONE,
          issues: [EpicGroomMother.BACKLOG_GATE, EpicGroomMother.BACKLOG_CHANNEL],
          key: EpicGroomMother.KEY,
        },
      ],
      [
        EpicGroomMother.authorised(),
        {
          kind: 'authorised',
          milestone: EpicGroomMother.MILESTONE,
          issues: [EpicGroomMother.READY_GATE, EpicGroomMother.READY_CHANNEL],
        },
      ],
    ]

    for (const [answer, expected] of cases) {
      answerWith(answer)
      const outcome = await EpicGroomClient.read()
      expect(outcome).toEqual(expected)
    }
  })

  it('a body that is none of them is unavailable', async () => {
    answerWith(EpicGroomMother.unrecognisedStatus())

    const outcome = await EpicGroomClient.read()

    expect(outcome).toEqual({ kind: 'unavailable' })
  })

  it('the groom sends the key and the plan fingerprint in x-gate-key and x-plan-fingerprint, and no body', async () => {
    const pressing = vi.fn(async () => new Response(EpicGroomMother.groomedByThePress().body, { status: 200 }))
    vi.stubGlobal('fetch', pressing)

    const outcome = await EpicGroomClient.groom(EpicGroomMother.KEY, EpicGroomMother.PLAN_FINGERPRINT)

    expect(pressing).toHaveBeenCalledWith('/epic-groom', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-plan-fingerprint': EpicGroomMother.PLAN_FINGERPRINT },
    })
    expect(outcome).toEqual({
      kind: 'acted',
      status: 'groomed',
      milestone: EpicGroomMother.MILESTONE,
      issues: [EpicGroomMother.BACKLOG_GATE, EpicGroomMother.BACKLOG_CHANNEL],
      promoted: [],
    })
  })

  it('the promotion answers which numbers it moved', async () => {
    const pressing = vi.fn(async () => new Response(EpicGroomMother.promoted().body, { status: 200 }))
    vi.stubGlobal('fetch', pressing)

    const outcome = await EpicGroomClient.promote(EpicGroomMother.KEY)

    expect(pressing).toHaveBeenCalledWith('/epic-promotion', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY },
    })
    expect(outcome).toEqual({
      kind: 'acted',
      status: 'authorised',
      milestone: EpicGroomMother.MILESTONE,
      issues: [EpicGroomMother.READY_GATE, EpicGroomMother.READY_CHANNEL],
      promoted: EpicGroomMother.PROMOTED,
    })
  })

  it('a press whose body does not parse as JSON reads as backend-unreachable rather than rejecting', async () => {
    answerWith({ status: 502, body: '<html><body>Bad Gateway</body></html>' })

    const outcome = await EpicGroomClient.groom(EpicGroomMother.KEY, EpicGroomMother.PLAN_FINGERPRINT)

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('a refusal carries the code and the detail the backend gave', async () => {
    answerWith(EpicGroomMother.notFromThePage())

    const outcome = await EpicGroomClient.groom(EpicGroomMother.KEY, EpicGroomMother.PLAN_FINGERPRINT)

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'gate-not-from-the-page',
      error: EpicGroomMother.NOT_FROM_THE_PAGE_DETAIL,
    })
  })

  it('a plan that changed since the preview refuses the same way as any other code', async () => {
    answerWith(EpicGroomMother.planChanged())

    const outcome = await EpicGroomClient.groom(EpicGroomMother.KEY, EpicGroomMother.CHANGED_PLAN_FINGERPRINT)

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'plan-changed',
      error: EpicGroomMother.PLAN_CHANGED_DETAIL,
    })
  })
})
