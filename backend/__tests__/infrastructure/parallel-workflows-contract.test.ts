import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Deferred, ParallelWorkflows, PlanWatchMother, RecoveryFixture } from '../fixtures/parallel-workflows.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'

type StartedAnswer = { agent: string, worktree: string, repo: string, issue: { number: number } }
type ListedAnswer = { plans: { phase: string }[] }

describe('Parallel workflow route compatibility', () => {
  let app: ParallelWorkflows

  beforeEach(async () => {
    app = new ParallelWorkflows()
    await app.listen()
  })

  afterEach(async () => {
    await app.stop()
  })

  it('keeps concurrent starts in the same repository independently addressable', async () => {
    const answers = await Promise.all([app.start('owner/alpha'), app.start('owner/alpha', 'ABC-8')])
    expect(answers.map((answer) => answer.status)).toEqual([202, 202])
    const plans = await Promise.all(answers.map(async (answer) => await answer.json() as StartedAnswer))
    expect(new Set(plans.map((plan) => plan.agent)).size).toBe(2)
    expect(new Set(plans.map((plan) => plan.worktree)).size).toBe(2)
    expect(plans.map((plan) => plan.issue.number).sort()).toEqual([7, 8])

    const selected = plans[1]
    const implemented = await app.post('/implement-plan', {
      agent: selected.agent, issue: selected.issue.number, repo: selected.repo,
    })

    expect(implemented.status).toBe(202)
    expect(app.agents.resume).toHaveBeenCalledExactlyOnceWith({
      agent: selected.agent, issue: selected.issue.number,
      repository: expect.objectContaining({ text: selected.repo }),
    })
    const listed = await (await app.listed()).json() as ListedAnswer
    expect(listed.plans).toHaveLength(2)
    expect(listed.plans.filter((plan: { phase: string }) => plan.phase === 'planning')).toHaveLength(1)
    expect(listed.plans.filter((plan: { phase: string }) => plan.phase === 'implementing')).toHaveLength(1)
  })

  it('preserves the existing list envelope for equal issue numbers across repositories', async () => {
    await app.start('owner/alpha')
    await app.start('owner/beta')

    const response = await app.listed()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      plans: ['alpha', 'beta'].map((name, index) => ({
        phase: 'planning',
        request: { id: 'ABC-7', repo: `owner/${name}`, path: `/owner/${name}` },
        plan: {
          id: 'ABC-7', repo: `owner/${name}`,
          issue: { number: 7, url: `https://github.com/owner/${name}/issues/7` },
          agent: `workspace:${20 + index}`, branch: 'feat/7', worktree: `/owner/${name}/.worktrees/7`,
        },
      })),
    })
  })

  it.each(['agent', 'marker'])('defers session replacement until the pending %s operation settles', async (stage) => {
    const started = await (await app.start('owner/alpha')).json() as StartedAnswer
    const recovery = new RecoveryFixture(app)
    const entered = new Deferred<void>()
    const released = new Deferred<void>()
    const operation = stage === 'agent' ? app.agents.resume : app.implementationStarts.remember
    operation.mockImplementationOnce(async () => {
      entered.resolve()
      await released.promise
    })
    const pending = app.post('/implement-plan', { repo: started.repo, issue: 7, agent: started.agent })
    await entered.promise
    recovery.watches = [PlanWatchMother.of('owner/alpha', 7, 'workspace:99')]
    await recovery.refresh()
    const during = app.activePlans.known()[0]?.plan.agent
    released.resolve()
    const answer = await pending
    await recovery.refresh()

    expect(during).toBe(started.agent)
    expect(answer.status).toBe(202)
    expect(app.activePlans.known()[0]?.plan.agent).toBe('workspace:99')
    expect(app.reviews.startRecovered).toHaveBeenCalledExactlyOnceWith(recovery.watches[0])
  })

  it('releases session protection when implementation fails', async () => {
    const started = await (await app.start('owner/alpha')).json() as StartedAnswer
    app.agents.resume.mockRejectedValueOnce(new PlanAgentNotResumed('old agent disappeared'))

    const refused = await app.post('/implement-plan', { repo: started.repo, issue: 7, agent: started.agent })
    const recovery = new RecoveryFixture(app)
    recovery.watches = [PlanWatchMother.of('owner/alpha', 7, 'workspace:99')]
    await recovery.refresh()

    expect(refused.status).toBe(400)
    expect(app.activePlans.known()[0]?.plan.agent).toBe('workspace:99')
  })
})
