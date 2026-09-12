import { describe, it, expect } from 'vitest'
import { ReadPlanProgress, ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.ts'
import { PlanProgress } from '../../src/domain/ports/plan-progress.ts'
import { ReviewLog } from '../../src/domain/ports/review-log.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanState, type PlanStateValue } from '../../src/domain/value-objects/plan-state.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class PlanProgressDouble extends PlanProgress {
  readonly answer: PlanStateValue
  readonly asked: { located: WorkspaceLocation, issue: PlanIssue, repository: RepositoryName }[]

  constructor(answer: PlanStateValue) {
    super()
    this.answer = answer
    this.asked = []
  }

  async of(subject: {
    located: WorkspaceLocation,
    issue: PlanIssue,
    repository: RepositoryName,
  }): Promise<PlanStateValue> {
    this.asked.push(subject)
    return this.answer
  }
}

describe('ReadPlanProgress', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const issue = new PlanIssue({ number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/42' })
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const progress = new PlanProgressDouble(PlanState.READY)

    const read = await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue, repository }))

    expect(read.state).toBe(PlanState.READY)
  })

  it('the_port_is_asked_about_the_workspace_and_the_issue_and_the_repository_it_was_given', async () => {
    const progress = new PlanProgressDouble(PlanState.WRITING)

    await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue, repository }))

    expect(progress.asked).toEqual([{ located, issue, repository }])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanProgress().of({ located, issue, repository })).rejects.toThrow(/must implement of/)
    await expect(new PlanProgress().committedAt({ located })).rejects.toThrow(/must implement committedAt/)
    expect(() => new ReviewLog().noted({ issue: issue.number, repository, at: '2026-09-09T10:00:00Z' }))
      .toThrow(/must implement noted/)
    expect(() => new ReviewLog().lastAskedAt({ issue: issue.number, repository })).toThrow(/must implement lastAskedAt/)
  })

  it('the_state_of_a_plan_is_one_of_exactly_two_and_reviewing_is_not_one_of_them', () => {
    expect(Object.values(PlanState)).toEqual(['writing', 'ready'])
  })
})
