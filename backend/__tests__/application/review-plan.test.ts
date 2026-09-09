import { describe, it, expect } from 'vitest'
import { ReviewPlan, ReviewPlanParams } from '../../src/application/actions/review-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'

class PlanAgentsDouble extends PlanAgents {
  readonly answer: Error | null
  readonly asked: { agent: string, issue: number, repository: RepositoryName, changes: string }[]

  constructor(answer: Error | null = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(cause: Error): PlanAgentsDouble {
    return new PlanAgentsDouble(cause)
  }

  async review({ agent, issue, repository, changes }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    this.asked.push({ agent, issue, repository, changes })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')
  static CHANGES = 'añade el caso de la issue sin descripción'

  readonly planAgents: PlanAgentsDouble

  constructor({ planAgents }: { planAgents?: PlanAgentsDouble } = {}) {
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run(): Promise<void> {
    return new ReviewPlan(this).execute(new ReviewPlanParams({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    }))
  }
}

describe('ReviewPlan', () => {
  it('the_agent_it_asks_to_review_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([{
      agent: Flow.AGENT,
      issue: Flow.ISSUE,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }])
  })

  it('an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({
      planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().review({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    })).rejects.toThrow(/must implement review/)
  })
})
