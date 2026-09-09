import { describe, it, expect } from 'vitest'
import { AskPlanChanges, AskPlanChangesParams } from '../../src/application/actions/ask-plan-changes.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanChangesNotAsked } from '../../src/domain/exceptions.ts'

class PlanIssuesSpy extends PlanIssues {
  readonly asked: { issue: number, repository: string, changes: string }[]

  constructor() {
    super()
    this.asked = []
  }

  async askChanges({ issue, repository, changes }: {
    issue: PlanIssue,
    repository: RepositoryName,
    changes: string,
  }): Promise<void> {
    this.asked.push({ issue: issue.number, repository: repository.text, changes })
  }
}

class RejectingPlanIssues extends PlanIssues {
  readonly cause: Error

  constructor(cause: Error) {
    super()
    this.cause = cause
  }

  async askChanges(): Promise<void> {
    throw this.cause
  }
}

const ISSUE = new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' })
const REPOSITORY = new RepositoryName('jjponz/repo-pulse')

describe('AskPlanChanges', () => {
  it('asks_the_issue_to_carry_the_changes_and_nothing_else', async () => {
    const planIssues = new PlanIssuesSpy()

    await new AskPlanChanges({ planIssues }).execute(
      new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })
    )

    expect(planIssues.asked).toEqual([
      { issue: 33, repository: 'jjponz/repo-pulse', changes: 'parte la tarea 2' },
    ])
  })

  it('a_port_that_refuses_to_ask_changes_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const planIssues = new RejectingPlanIssues(new PlanChangesNotAsked('GitHub API failed'))

    const refusal = await new AskPlanChanges({ planIssues }).execute(
      new AskPlanChangesParams({ issue: ISSUE, repository: REPOSITORY, changes: 'parte la tarea 2' })
    ).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanChangesNotAsked)
    expect(refusal.message).toBe('GitHub API failed')
  })
})
