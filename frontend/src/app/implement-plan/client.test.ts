import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { ImplementPlanClient } from 'app/implement-plan/client'

const request = () => ({
  agent: ImplementPlanMother.AGENT,
  issue: ImplementPlanMother.ISSUE,
  repo: ImplementPlanMother.REPO,
})

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

describe('ImplementPlanClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should report a stale agent handle by code, not by status', async () => {
    answerWith(ImplementPlanMother.noLiveSession())

    const outcome = await ImplementPlanClient.implement(request())

    expect(outcome).toEqual({ kind: 'stale-agent', detail: 'no active plan matches that issue' })
  })

  it('should report an uncertain implementation phase by code, not by status', async () => {
    answerWith(ImplementPlanMother.implementationUncertain())

    const outcome = await ImplementPlanClient.implement(request())

    expect(outcome).toEqual({ kind: 'uncertain', detail: 'cannot tell whether implementation already began' })
  })

  it('should name a plan under review by code, so the page can say it in its own words', async () => {
    answerWith(ImplementPlanMother.planUnderReview())

    const outcome = await ImplementPlanClient.implement(request())

    expect(outcome).toEqual({ kind: 'under-review' })
  })

  it('should keep other refusals generic, carrying only their detail', async () => {
    answerWith(ImplementPlanMother.agentNotResumed())

    const outcome = await ImplementPlanClient.implement(request())

    expect(outcome).toEqual({ kind: 'refused', detail: 'cmux send failed: no such workspace' })
  })
})
