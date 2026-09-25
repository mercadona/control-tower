import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { ActivePlansClient } from 'app/active-plans/client'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'

const activePlan = (): ActivePlan => ({
  phase: 'planning',
  request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
  plan: {
    id: StartPlanMother.TICKET,
    repo: StartPlanMother.REPO,
    issue: StartPlanMother.ISSUE,
    agent: StartPlanMother.AGENT,
    branch: StartPlanMother.BRANCH,
    worktree: StartPlanMother.WORKTREE,
  },
})

const answerWith = (plan: ActivePlan) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plans: [plan] }), { status: 200 })))
}

const activePlanWithoutStory = (): ActivePlan => ({
  phase: 'planning',
  request: { id: null, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
  plan: {
    id: null,
    repo: StartPlanMother.REPO,
    issue: { number: 9, url: 'https://github.com/owner/name/issues/9' },
    agent: 'workspace:5',
    branch: 'feat/9',
    worktree: `${StartPlanMother.PATH}/.worktrees/9`,
  },
})

const uncertainPlan = (): ActivePlan => ({
  ...activePlan(),
  phase: 'uncertain',
  diagnostic: 'the recorded call needs inspection',
  recovery: { action: 'inspect', detail: 'refresh evidence only' },
})

describe('ActivePlansClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should load a valid backend active plan without the optional description', async () => {
    const plan = activePlan()
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it('should load an active plan with no user story, with a null id', async () => {
    const plan = activePlanWithoutStory()
    answerWith(plan as ActivePlan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it('should load an uncertain active plan', async () => {
    const plan = uncertainPlan()
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it.each([
    ['missing recovery metadata', (plan: Record<string, unknown>) => { delete plan.recovery }],
    ['unknown recovery action', (plan: Record<string, unknown>) => {
      plan.recovery = { action: 'restart', detail: 'not allowed' }
    }],
    ['non-string recovery detail', (plan: Record<string, unknown>) => {
      plan.recovery = { action: 'inspect', detail: 12 }
    }],
  ])('malformed recovery metadata is refused: %s', async (_name, mutate) => {
    const plan = uncertainPlan() as unknown as Record<string, unknown>
    mutate(plan)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plans: [plan] }), { status: 200 })))

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })

  it('recover sends exact identity and validates acceptance', async () => {
    const plan = { ...uncertainPlan(), recovery: { action: 'continue' as const, detail: 'continue planner' } }
    const fetching = vi.fn(async () => new Response(JSON.stringify({ agent: plan.plan.agent }), { status: 202 }))
    vi.stubGlobal('fetch', fetching)

    expect(await ActivePlansClient.recover(plan)).toEqual({ kind: 'accepted', agent: plan.plan.agent })
    expect(fetching).toHaveBeenCalledWith('/recover-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: plan.plan.repo, issue: plan.plan.issue.number, agent: plan.plan.agent }),
    })
  })

  it('cleanup keeps the code of a refusal and tells it in Spanish', async () => {
    const plan = { ...uncertainPlan(), recovery: { action: 'cleanup' as const, detail: 'cleanup available' } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"code":"cleanup-plan-conflict","detail":"workspace changed"}', { status: 400 },
    )))

    expect(await ActivePlansClient.cleanup(plan)).toEqual({
      kind: 'refused', code: 'cleanup-plan-conflict', detail: 'El estado actual del trabajo no permite limpiarlo sin riesgo.',
    })
  })

  it('malformed recovery replies are unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"agent":"another-agent"}', { status: 202 })))

    expect(await ActivePlansClient.recover(uncertainPlan())).toEqual({ kind: 'unavailable' })
  })

  it('uncertain scenarios satisfy the recovery wire contract', async () => {
    for (const answer of [
      HeadlessPlanMother.uncertain(),
      HeadlessPlanMother.awaitingObservation(),
      HeadlessPlanMother.awaitingContinuation(),
      HeadlessPlanMother.unlaunched(),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
      expect(await ActivePlansClient.get()).toEqual(expect.objectContaining({ kind: 'loaded' }))
    }
  })

  it.each([
    ['invalid request ticket', (value: ActivePlan) => { value.request.id = 'abc-123' }],
    ['invalid request repository', (value: ActivePlan) => { value.request.repo = 'name' }],
    ['invalid request path', (value: ActivePlan) => { value.request.path = 'relative' }],
    ['non-positive issue', (value: ActivePlan) => { value.plan.issue = { ...value.plan.issue, number: -1 } }],
    ['empty URL', (value: ActivePlan) => { value.plan.issue = { ...value.plan.issue, url: '' } }],
    ['empty agent', (value: ActivePlan) => { value.plan.agent = ' ' }],
    ['empty branch', (value: ActivePlan) => { value.plan.branch = '' }],
    ['empty worktree', (value: ActivePlan) => { value.plan.worktree = '' }],
    ['mismatched ticket', (value: ActivePlan) => { value.plan.id = 'XYZ-456' }],
    ['a plan id present when the request has none', (value: ActivePlan) => {
      value.request.id = null
      value.plan.id = 'XYZ-456'
    }],
    ['mismatched repository', (value: ActivePlan) => { value.plan.repo = 'owner/other' }],
    ['worktree outside the request path', (value: ActivePlan) => { value.plan.worktree = '/tmp/worktree' }],
  ])('should reject an active plan with an %s', async (_case, makeInvalid) => {
    const plan = activePlan()
    makeInvalid(plan)
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })

  it('should reject a malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })

  it('should report recovery as inconclusive when the backend says cmux could not be asked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"code":"active-plans-recovery-inconclusive","detail":"cmux could not be asked"}',
            { status: 400 },
          ),
      ),
    )

    expect(await ActivePlansClient.get()).toEqual({ kind: 'inconclusive' })
  })

  it('should report unavailable, not inconclusive, when the backend cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })

  it('should report unavailable for a refusal with a different code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"foreign-origin","detail":"not this page"}', { status: 403 })),
    )

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })
})
