import { ReviewPlanMother } from '__scenarios__/ReviewPlanMother'
import { ReviewPlanClient } from 'app/review-plan/client'

const request = () => ({
  issue: ReviewPlanMother.ISSUE,
  repo: ReviewPlanMother.REPO,
  changes: ReviewPlanMother.CHANGES,
})

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

describe('ReviewPlanClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should tell the accepted case apart by status, with no payload of its own', async () => {
    answerWith(ReviewPlanMother.changesAsked())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'changes-asked' })
  })

  it('should post the three fields the backend demands and declare JSON', async () => {
    answerWith(ReviewPlanMother.changesAsked())

    await ReviewPlanClient.askChanges(request())

    expect(fetch).toHaveBeenCalledWith('/review-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ReviewPlanMother.REQUEST_BODY,
    })
  })

  it('should report a plan the backend no longer watches by code, not by status', async () => {
    answerWith(ReviewPlanMother.asABadRequest(ReviewPlanMother.noLiveSession()))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({
      kind: 'stale-plan',
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })
  })

  it('should report a plan already being implemented by code, not by status', async () => {
    answerWith(ReviewPlanMother.asABadRequest(ReviewPlanMother.alreadyImplementing()))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({
      kind: 'plan-implementing',
      detail: 'the plan is already being implemented, so its review watch is gone',
    })
  })

  it('should report a phase it cannot be sure of by code, not by status', async () => {
    answerWith(ReviewPlanMother.asABadRequest(ReviewPlanMother.phaseUncertain()))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({
      kind: 'phase-uncertain',
      detail: 'implementation may have started; inspect the plan before retrying',
    })
  })

  it('should keep a conflict carrying a code it does not know generic, so no status decides a kind', async () => {
    answerWith(ReviewPlanMother.asAConflict(ReviewPlanMother.notAsked()))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'refused', detail: 'gh issue comment failed: gh: not found' })
  })

  it('should keep other refusals generic, carrying only their detail', async () => {
    answerWith(ReviewPlanMother.notAsked())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'refused', detail: 'gh issue comment failed: gh: not found' })
  })

  it('should tell a backend it cannot reach apart from one that refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })
})
