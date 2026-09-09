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

  it('should report accepted changes by status, carrying the issue they were asked on', async () => {
    answerWith(ReviewPlanMother.changesAsked())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({ kind: 'changes-asked', issue: ReviewPlanMother.ISSUE })
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
    answerWith(ReviewPlanMother.noLiveSession())

    const outcome = await ReviewPlanClient.askChanges(request())

    expect(outcome).toEqual({
      kind: 'stale-plan',
      detail: 'no matching live planning session exists, so nobody would read the changes',
    })
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
