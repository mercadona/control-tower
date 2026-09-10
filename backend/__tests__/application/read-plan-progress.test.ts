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

class ReviewLogDouble extends ReviewLog {
  lastAskedAt(): string | null {
    return null
  }
}

describe('ReadPlanProgress', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const issue = new PlanIssue({ number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/42' })
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const progress = new PlanProgressDouble(PlanState.READY)

    const read = await new ReadPlanProgress({ planProgress: progress, reviewLog: new ReviewLogDouble() })
      .execute(new ReadPlanProgressParams({ located, issue, repository }))

    expect(read.state).toBe(PlanState.READY)
  })

  it('the_port_is_asked_about_the_workspace_and_the_issue_and_the_repository_it_was_given', async () => {
    const progress = new PlanProgressDouble(PlanState.WRITING)

    await new ReadPlanProgress({ planProgress: progress, reviewLog: new ReviewLogDouble() })
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
})

const ISSUE = new PlanIssue({ number: 54, url: 'https://github.com/jjponz/repo-pulse/issues/54' })
const REPOSITORY = new RepositoryName('jjponz/repo-pulse')
const LOCATED = new WorkspaceLocation({ path: '/repo/.worktrees/54', branch: 'feat/54' })

class FlowReviewLog extends ReviewLog {
  readonly answer: string | null
  readonly askedFor: { issue: number, repository: RepositoryName }[]

  constructor(askedAt: string | null) {
    super()
    this.answer = askedAt
    this.askedFor = []
  }

  lastAskedAt(asked: { issue: number, repository: RepositoryName }): string | null {
    this.askedFor.push(asked)

    return this.answer
  }
}

class FlowPlanProgress extends PlanProgress {
  readonly dated: string | null
  readonly onDisk: PlanStateValue
  committedAsked: number
  diskAsked: number

  constructor({ committedAt, onDisk }: { committedAt: string | null, onDisk: PlanStateValue }) {
    super()
    this.dated = committedAt
    this.onDisk = onDisk
    this.committedAsked = 0
    this.diskAsked = 0
  }

  async committedAt(): Promise<string | null> {
    this.committedAsked += 1

    return this.dated
  }

  async of(): Promise<PlanStateValue> {
    this.diskAsked += 1

    return this.onDisk
  }
}

class Flow {
  readonly reviewLog: FlowReviewLog
  readonly planProgress: FlowPlanProgress

  constructor({ askedAt = null, committedAt = null, onDisk = PlanState.READY }: {
    askedAt?: string | null,
    committedAt?: string | null,
    onDisk?: PlanStateValue,
  } = {}) {
    this.reviewLog = new FlowReviewLog(askedAt)
    this.planProgress = new FlowPlanProgress({ committedAt, onDisk })
  }

  async run(): Promise<PlanStateValue> {
    const read = await new ReadPlanProgress({
      planProgress: this.planProgress,
      reviewLog: this.reviewLog,
    }).execute(new ReadPlanProgressParams({ located: LOCATED, issue: ISSUE, repository: REPOSITORY }))

    return read.state
  }
}

describe('a plan being reworked is told apart from one waiting for a person', () => {
  it('a_plan_nobody_asked_changes_for_is_read_from_disk_and_git_is_not_asked_for_a_date', async () => {
    const flow = new Flow({ askedAt: null, onDisk: PlanState.WRITING })

    expect(await flow.run()).toBe(PlanState.WRITING)
    expect(flow.planProgress.committedAsked).toBe(0)
    expect(flow.reviewLog.askedFor).toEqual([{ issue: 54, repository: REPOSITORY }])
  })

  it('a_change_asked_for_after_the_plan_was_committed_is_a_review_in_flight_and_disk_is_not_asked', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: '2026-09-09T09:00:00Z' })

    expect(await flow.run()).toBe(PlanState.REVIEWING)
    expect(flow.planProgress.diskAsked).toBe(0)
  })

  it('a_change_asked_for_on_a_plan_that_was_never_committed_is_a_review_in_flight', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: null })

    expect(await flow.run()).toBe(PlanState.REVIEWING)
  })

  it('a_change_asked_for_before_the_plan_was_recommitted_is_no_longer_in_flight', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T09:00:00Z', committedAt: '2026-09-09T10:00:00Z' })

    expect(await flow.run()).toBe(PlanState.READY)
  })

  it('a_plan_recommitted_in_the_very_second_the_change_was_asked_for_is_no_longer_in_flight', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: '2026-09-09T10:00:00Z' })

    expect(await flow.run()).toBe(PlanState.READY)
  })

  it('the_two_dates_are_compared_as_moments_and_not_as_text_because_git_and_github_do_not_write_them_alike', async () => {
    const asText = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: '2026-09-09T11:00:00+02:00' })

    expect(await asText.run()).toBe(PlanState.REVIEWING)

    const other = new Flow({ askedAt: '2026-09-09T09:54:05Z', committedAt: '2026-09-09T11:55:39+02:00' })

    expect(await other.run()).toBe(PlanState.READY)
  })

  it('a_date_that_cannot_be_read_as_a_moment_does_not_claim_a_review', async () => {
    const flow = new Flow({ askedAt: 'not a date', onDisk: PlanState.READY })

    expect(await flow.run()).toBe(PlanState.READY)
    expect(flow.planProgress.committedAsked).toBe(0)
  })

  it('a_commit_date_that_cannot_be_read_falls_through_to_the_disk_state_instead_of_hanging', async () => {
    const flow = new Flow({ askedAt: '2026-09-09T10:00:00Z', committedAt: 'not a date', onDisk: PlanState.WRITING })

    expect(await flow.run()).toBe(PlanState.WRITING)
  })
})
