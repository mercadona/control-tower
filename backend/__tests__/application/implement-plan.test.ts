import { describe, it, expect } from 'vitest'
import { ImplementPlan, ImplementPlanParams } from '../../src/application/actions/implement-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { GoRegistry } from '../../src/domain/ports/go-registry.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import {
  PlanAgentNotResumed, PlanGoNotAnswered, GoNotRecorded,
} from '../../src/domain/exceptions.ts'

class GoRegistryDouble extends GoRegistry {
  static NONCE = '7f3a91c2'

  readonly answer: string | Error
  readonly asked: { issueNumber: number, repository: RepositoryName }[]

  constructor(answer: string | Error = GoRegistryDouble.NONCE) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(said: string): GoRegistryDouble {
    return new GoRegistryDouble(new GoNotRecorded(said))
  }

  async mint({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<string> {
    this.asked.push({ issueNumber, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class PlanIssuesDouble extends PlanIssues {
  readonly failure: Error | null
  readonly answered: { issueNumber: number, repository: RepositoryName, nonce: string }[]

  constructor(failure: Error | null = null) {
    super()
    this.failure = failure
    this.answered = []
  }

  static refusing(said: string): PlanIssuesDouble {
    return new PlanIssuesDouble(new PlanGoNotAnswered(said))
  }

  async answerGo({ issueNumber, repository, nonce }: {
    issueNumber: number,
    repository: RepositoryName,
    nonce: string,
  }): Promise<void> {
    this.answered.push({ issueNumber, repository, nonce })
    if (this.failure !== null) throw this.failure
  }
}

class PlanAgentsDouble extends PlanAgents {
  readonly answer: Error | null
  readonly asked: { agent: string, issue: number, repository: RepositoryName }[]

  constructor(answer: Error | null = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(cause: Error): PlanAgentsDouble {
    return new PlanAgentsDouble(cause)
  }

  async resume({ agent, issue, repository }: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): Promise<void> {
    this.asked.push({ agent, issue, repository })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')

  readonly goRegistry: GoRegistryDouble
  readonly planIssues: PlanIssuesDouble
  readonly planAgents: PlanAgentsDouble

  constructor({ goRegistry, planIssues, planAgents }: {
    goRegistry?: GoRegistryDouble,
    planIssues?: PlanIssuesDouble,
    planAgents?: PlanAgentsDouble,
  } = {}) {
    this.goRegistry = goRegistry ?? new GoRegistryDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run(): Promise<void> {
    return new ImplementPlan(this).execute(new ImplementPlanParams({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ImplementPlan', () => {
  it('the_agent_it_resumes_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
  })

  it('an_agent_that_cannot_be_resumed_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })
})

describe('ImplementPlan closes the plan gate before the agent works', () => {
  it('the_go_is_recorded_and_answered_on_the_issue_before_the_agent_is_told_to_implement', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.goRegistry.asked).toEqual([
      { issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
    expect(flow.planIssues.answered).toEqual([
      { issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY, nonce: GoRegistryDouble.NONCE },
    ])
    expect(flow.planAgents.asked).toHaveLength(1)
  })

  it('a_go_that_could_not_be_recorded_never_reaches_the_issue_nor_the_agent', async () => {
    const flow = new Flow({ goRegistry: GoRegistryDouble.refusing('the directory is not writable') })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(GoNotRecorded)
    expect(flow.planIssues.answered).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
  })

  it('a_go_the_issue_did_not_take_leaves_the_agent_parked_instead_of_working_without_a_gate', async () => {
    const flow = new Flow({ planIssues: PlanIssuesDouble.refusing('gh: not authenticated') })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanGoNotAnswered)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('a_registry_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new GoRegistry().mint({
      issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement mint/)
    await expect(new PlanIssues().answerGo({
      issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY, nonce: 'aa',
    })).rejects.toThrow(/must implement answerGo/)
    await expect(new PlanAgents().resume({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement resume/)
  })
})
