import { describe, it, expect } from 'vitest'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.ts'
import { Workbench } from '../../src/domain/ports/workbench.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import {
  PlanIssueStatus, type PlanIssueStatusValue,
} from '../../src/domain/value-objects/plan-issue-status.ts'
import { PlanStatusNotRead, SliceNotReopened, PlanAgentNotResumed } from '../../src/domain/exceptions.ts'

type ReopenSubject = Parameters<Workbench['reopen']>[0]
type FixSubject = Parameters<PlanAgents['fix']>[0]

class WorkbenchDouble extends Workbench {
  readonly failing: Error | null
  readonly asked: ReopenSubject[]

  constructor(failing: Error | null = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause: Error) {
    return new WorkbenchDouble(cause)
  }

  async reopen(subject: ReopenSubject): Promise<void> {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class PlanAgentsDouble extends PlanAgents {
  readonly failing: Error | null
  readonly asked: FixSubject[]

  constructor(failing: Error | null = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause: Error) {
    return new PlanAgentsDouble(cause)
  }

  async fix(subject: FixSubject): Promise<void> {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class PlanIssuesDouble extends PlanIssues {
  readonly status: PlanIssueStatusValue
  readonly failing: Error | null
  readonly asked: Array<{ issueNumber: number, repository: RepositoryName }>

  constructor(status: PlanIssueStatusValue = PlanIssueStatus.IN_REVIEW, failing: Error | null = null) {
    super()
    this.status = status
    this.failing = failing
    this.asked = []
  }

  static refusing(cause: Error) {
    return new PlanIssuesDouble(PlanIssueStatus.IN_REVIEW, cause)
  }

  override async statusOf(subject: { issueNumber: number, repository: RepositoryName }): Promise<PlanIssueStatusValue> {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
    return this.status
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE_NUMBER = 7
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static CHANGES = 'src/foo.js:42: revienta con []'
  static REQUEST_ID = 'PRR_kwDOT9lB5c8AAAABRCF0GG'

  readonly workbench: WorkbenchDouble
  readonly planAgents: PlanAgentsDouble
  readonly planIssues: PlanIssuesDouble

  constructor({ workbench, planAgents, planIssues }: {
    workbench?: WorkbenchDouble,
    planAgents?: PlanAgentsDouble,
    planIssues?: PlanIssuesDouble,
  } = {}) {
    this.workbench = workbench ?? new WorkbenchDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble()
  }

  static reopened() {
    return new Flow()
  }

  static standing(status: PlanIssueStatusValue) {
    return new Flow({ planIssues: new PlanIssuesDouble(status) })
  }

  static refusingTheReopen(cause = new SliceNotReopened('sigue en in-review')) {
    return new Flow({ workbench: WorkbenchDouble.refusing(cause) })
  }

  async run() {
    return new RequestFixes(this).execute(new RequestFixesParams({
      agent: Flow.AGENT,
      issue: Flow.ISSUE_NUMBER,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
      requestId: Flow.REQUEST_ID,
    }))
  }
}

describe('RequestFixes', () => {
  it('a slice under review is reopened before the change reaches its conversation', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.workbench.asked).toEqual([{ issueNumber: Flow.ISSUE_NUMBER, repository: Flow.REPOSITORY }])
    expect(flow.planAgents.asked).toEqual([{
      agent: Flow.AGENT,
      issue: Flow.ISSUE_NUMBER,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
      requestId: Flow.REQUEST_ID,
    }])
  })

  it('a slice already on the workbench is not asked for a reopen that does not apply', async () => {
    const flow = Flow.standing(PlanIssueStatus.IN_PROGRESS)

    await flow.run()

    expect(flow.planIssues.asked).toEqual([{
      issueNumber: Flow.ISSUE_NUMBER, repository: Flow.REPOSITORY,
    }])
    expect(flow.workbench.asked).toEqual([])
    expect(flow.planAgents.asked).toHaveLength(1)
    expect(flow.planAgents.asked[0].changes).toBe(Flow.CHANGES)
  })

  it('no status other than in-review asks the workbench for anything', async () => {
    const statuses = [PlanIssueStatus.READY, PlanIssueStatus.BACKLOG, PlanIssueStatus.NONE] as const

    for (const status of statuses) {
      const flow = Flow.standing(status)

      await flow.run()

      expect(flow.workbench.asked).toEqual([])
      expect(flow.planAgents.asked).toHaveLength(1)
    }
  })

  it('a status that cannot be read stops the change instead of guessing the slice is on the workbench', async () => {
    const flow = new Flow({
      planIssues: PlanIssuesDouble.refusing(new PlanStatusNotRead('gh issue view --json labels failed')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanStatusNotRead)
    expect(flow.workbench.asked).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
  })

  it('a_reopen_that_failed_leaves_the_agent_untold_so_the_change_is_not_half_delivered', async () => {
    const flow = Flow.refusingTheReopen()

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({
      planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('no such workspace')
  })

  it('the_agent_it_types_into_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.planAgents.asked[0].agent).toBe(Flow.AGENT)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().fix({
      agent: Flow.AGENT, issue: Flow.ISSUE_NUMBER, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    })).rejects.toThrow(/must implement fix/)
  })
})
