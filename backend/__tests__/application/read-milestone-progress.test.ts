import { describe, expect, it } from 'vitest'
import {
  ReadMilestoneProgress, ReadMilestoneProgressParams,
} from '../../src/application/queries/read-milestone-progress.ts'
import { SliceLineState } from '../../src/domain/value-objects/slice-line.ts'
import { SliceTaskStatus } from '../../src/domain/value-objects/slice-task.ts'
import { DriveRun } from '../../src/application/actions/drive-run.ts'
import { EpicSpecs } from '../../src/domain/ports/epic-specs.ts'
import { EpicIssues } from '../../src/domain/ports/epic-issues.ts'
import { WorkInventory } from '../../src/domain/ports/work-inventory.ts'
import { PlanningActivities } from '../../src/domain/ports/planning-activity.ts'
import { ImplementationActivities } from '../../src/domain/ports/implementation-activities.ts'
import { ImplementationHistory } from '../../src/domain/ports/implementation-history.ts'
import { SliceBaselines } from '../../src/domain/ports/slice-baselines.ts'
import { EpicIssuesListing } from '../../src/domain/value-objects/epic-issues-listing.ts'
import { EpicIssue } from '../../src/domain/value-objects/epic-issue.ts'
import { TrackedWork } from '../../src/domain/value-objects/tracked-work.ts'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.ts'
import type { ImplementationStepValue } from '../../src/domain/value-objects/implementation-state.ts'
import { ImplementationHistoryEntry } from '../../src/domain/value-objects/implementation-history-entry.ts'
import { ImplementationActivity } from '../../src/domain/value-objects/implementation-activity.ts'
import { PlanningActivity, PlanningActivityState, PlanningToolCall } from '../../src/domain/value-objects/planning-activity.ts'
import { WorkNotFound, ImplementationActivityNotRead, ImplementationProgressNotRead } from '../../src/domain/exceptions.ts'
import type { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import type { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.ts'
import { EpicSpecsDouble } from '../epic-specs-double.ts'
import { MilestoneProgressMother } from '../milestone-progress-mother.ts'

type SpecAsked = { root: CheckoutRoot, story: UserStoryKey | UserStoryUrl }
type IssuesAsked = { repository: RepositoryName, milestone: string }
type ImplementationParamsLike = { root: CheckoutRoot, issue: number, repository: RepositoryName }
type ImplementationResultLike = {
  state: ImplementationState,
  delivery: { readonly kind: 'verified' } | { readonly kind: 'unavailable', readonly detail: string },
}

class EpicIssuesDouble extends EpicIssues {
  answer: EpicIssuesListing
  asked: IssuesAsked[] = []

  constructor(issues: EpicIssue[]) {
    super()
    this.answer = new EpicIssuesListing({ issues, exhausted: true, reason: null })
  }

  override async listOf(subject: IssuesAsked): Promise<EpicIssuesListing> {
    this.asked.push(subject)
    return this.answer
  }

  override async promote(): Promise<void> {
    throw new Error('reading milestone progress never promotes an issue')
  }
}

class UnaskedEpicIssues extends EpicIssues {
  override async listOf(): Promise<EpicIssuesListing> {
    throw new Error('a draft spec must not read the milestone issues')
  }
}

class WorkInventoryDouble extends WorkInventory {
  readonly answers: ReadonlyMap<number, TrackedWork | Error>
  readonly asked: { issue: number, repository: RepositoryName }[] = []

  constructor(answer: TrackedWork | Error, answers: ReadonlyMap<number, TrackedWork | Error> | null = null) {
    super()
    this.answers = answers ?? new Map([[MilestoneProgressMother.ISSUE_NUMBER, answer]])
  }

  static notFound(): WorkInventoryDouble {
    return new WorkInventoryDouble(new WorkNotFound('no recorded work'))
  }

  static byIssue(answers: ReadonlyMap<number, TrackedWork | Error>): WorkInventoryDouble {
    return new WorkInventoryDouble(new WorkNotFound('unused'), answers)
  }

  override async find(issue: number, repository: RepositoryName): Promise<TrackedWork> {
    this.asked.push({ issue, repository })
    const answer = this.answers.get(issue) ?? new WorkNotFound(`no recorded work for #${issue}`)
    if (answer instanceof Error) throw answer
    return answer
  }
}

class UnaskedImplementationProgress {
  async execute(): Promise<ImplementationResultLike> {
    throw new Error('a pending or delivered line must not read the implementation progress')
  }
}

class ImplementationProgressDouble {
  readonly answer: ImplementationResultLike

  constructor(answer: ImplementationResultLike) {
    this.answer = answer
  }

  async execute(_params: ImplementationParamsLike): Promise<ImplementationResultLike> {
    return this.answer
  }
}

class FailingImplementationProgress {
  readonly failure: Error

  constructor(failure: Error) {
    this.failure = failure
  }

  async execute(): Promise<ImplementationResultLike> {
    throw this.failure
  }
}

class UnaskedPlanningActivities extends PlanningActivities {
  override async of(): Promise<PlanningActivity> {
    throw new Error('an implementing, pending or delivered line must not read the planning activity')
  }
}

class PlanningActivityDouble extends PlanningActivities {
  readonly answer: PlanningActivity

  constructor(answer: PlanningActivity) {
    super()
    this.answer = answer
  }

  override async of(): Promise<PlanningActivity> {
    return this.answer
  }
}

class UnaskedImplementationActivities extends ImplementationActivities {
  override async of(): Promise<ImplementationActivity | null> {
    throw new Error('a pending or delivered line must not read the implementation activity')
  }
}

class ImplementationActivityDouble extends ImplementationActivities {
  readonly answer: ImplementationActivity | Error

  constructor(answer: ImplementationActivity | Error) {
    super()
    this.answer = answer
  }

  static failing(): ImplementationActivityDouble {
    return new ImplementationActivityDouble(new ImplementationActivityNotRead('the stream could not be read'))
  }

  override async of(): Promise<ImplementationActivity | null> {
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class UnaskedImplementationHistory extends ImplementationHistory {
  override async of(): Promise<ImplementationHistoryEntry[]> {
    throw new Error('a pending or delivered line must not read the implementation history')
  }
}

class ImplementationHistoryDouble extends ImplementationHistory {
  readonly entries: ImplementationHistoryEntry[] | Error
  readonly asked: { root: CheckoutRoot, issue: number, repository: RepositoryName }[] = []

  constructor(entries: ImplementationHistoryEntry[] | Error) {
    super()
    this.entries = entries
  }

  override async of(asked: { root: CheckoutRoot, issue: number, repository: RepositoryName }): Promise<ImplementationHistoryEntry[]> {
    this.asked.push(asked)
    if (this.entries instanceof Error) throw this.entries
    return this.entries
  }
}

class UnaskedSliceBaselines extends SliceBaselines {
  override async isRed(): Promise<boolean> {
    throw new Error('a pending or delivered line must not read the baseline')
  }
}

class SliceBaselinesDouble extends SliceBaselines {
  readonly answer: boolean | Error
  readonly asked: { root: CheckoutRoot, issue: number }[] = []

  constructor(answer: boolean | Error) {
    super()
    this.answer = answer
  }

  override async isRed(asked: { root: CheckoutRoot, issue: number }): Promise<boolean> {
    this.asked.push(asked)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class Mother {
  static historyEntry(writtenAt: string | null): ImplementationHistoryEntry {
    return ImplementationHistoryEntry.of({
      step: 'implement', task: 2, taskName: 'Keep progress visible', tasksTotal: 5, attempt: 1,
      outcome: null, writtenAt, durationMs: null, summary: null, ruling: null, findingsTotal: null,
      toolTotalTokens: null,
    })
  }

  static taskHistoryEntry({ task, taskName, ruling, writtenAt }: {
    task: number, taskName: string | null, ruling: string | null, writtenAt: string,
  }): ImplementationHistoryEntry {
    return ImplementationHistoryEntry.of({
      step: 'implement', task, taskName, tasksTotal: 2, attempt: 1,
      outcome: null, writtenAt, durationMs: null, summary: null, ruling, findingsTotal: null,
      toolTotalTokens: null,
    })
  }

  static finished(pullRequest: { number: number, url: string } | null): TrackedWork {
    return new TrackedWork(MilestoneProgressMother.watch(), {
      phase: 'finished', harvestedAt: '2026-09-25T09:00:00.000Z', pullRequest,
    })
  }

  static implementing(number = MilestoneProgressMother.ISSUE_NUMBER): TrackedWork {
    return new TrackedWork(MilestoneProgressMother.watch(number), { phase: 'implementing', acceptsChange: true })
  }

  static planning(): TrackedWork {
    return new TrackedWork(MilestoneProgressMother.watch(), { phase: 'planning' })
  }

  static planningActivity(runningMs: number): PlanningActivity {
    return new PlanningActivity({
      state: PlanningActivityState.RUNNING, runningMs, toolCalls: 3,
      lastToolCall: new PlanningToolCall({ name: 'Read', argument: 'docs/spec.md' }), lastText: 'reading the plan',
    })
  }

  static finishedPlanningActivity(): PlanningActivity {
    return new PlanningActivity({
      state: PlanningActivityState.FINISHED, runningMs: 90_000, toolCalls: 6,
      lastToolCall: new PlanningToolCall({ name: 'Write', argument: 'docs/spec.md' }), lastText: 'done',
    })
  }

  static implementationState(): ImplementationState {
    return ImplementationState.of({
      step: 'implement', task: 2, totalTasks: 5, name: 'Keep progress visible', attempt: 1, discards: 0,
    })
  }

  static implementationStateOf({ task, totalTasks, step = ImplementationStep.IMPLEMENT }: {
    task: number, totalTasks: number, step?: ImplementationStepValue,
  }): ImplementationState {
    return ImplementationState.of({
      step, task, totalTasks, name: 'Keep progress visible', attempt: 1, discards: 0,
    })
  }

  static vetoed({ task, findings, verdict }: { task: number, findings: string, verdict: string }): TrackedWork {
    return new TrackedWork(MilestoneProgressMother.watch(), {
      phase: 'uncertain',
      diagnostic: 'the run closed at blocked-judge',
      recovery: { action: 'observe', detail: 'talk to the coordinating session' },
      refusal: { state: DriveRun.BLOCKED_JUDGE, outcome: 'failed', exit: 1, task, findings, verdict, vetoed: null, failure: null },
      execution: Mother.implementationStateOf({ task, totalTasks: 3, step: ImplementationStep.JUDGE }),
    })
  }

  static uncertainRecoverable({ action, detail }: {
    action: 'observe' | 'continue' | 'cleanup' | 'inspect', detail: string,
  }): TrackedWork {
    return new TrackedWork(MilestoneProgressMother.watch(), {
      phase: 'uncertain',
      diagnostic: 'the run could not be resolved',
      recovery: { action, detail },
      refusal: null,
      execution: null,
    })
  }

  static implementationResult(state = Mother.implementationState()): ImplementationResultLike {
    return { state, delivery: { kind: 'verified' } }
  }

  static activity(startedAt: string): ImplementationActivity {
    return new ImplementationActivity({
      startedAt, lastToolCall: new PlanningToolCall({ name: 'Bash', argument: 'npx vitest run' }), lastText: 'running the suite',
    })
  }
}

class Subject {
  specs: EpicSpecs
  issues: EpicIssues = new UnaskedEpicIssues()
  inventory: WorkInventory = WorkInventoryDouble.notFound()
  implementation: { execute(params: ImplementationParamsLike): Promise<ImplementationResultLike> } =
    new UnaskedImplementationProgress()
  planning: PlanningActivities = new UnaskedPlanningActivities()
  activities: ImplementationActivities = new UnaskedImplementationActivities()
  history: ImplementationHistory = new UnaskedImplementationHistory()
  baselines: SliceBaselines = new UnaskedSliceBaselines()
  nowMsValue = Date.parse('2026-09-25T12:00:00.000Z')

  constructor(spec = MilestoneProgressMother.frozenSpec()) {
    this.specs = new EpicSpecsDouble(spec)
  }

  query(): ReadMilestoneProgress {
    return new ReadMilestoneProgress({
      specs: this.specs, issues: this.issues, inventory: this.inventory, implementation: this.implementation,
      planning: this.planning, activities: this.activities, history: this.history, baselines: this.baselines,
      nowMs: () => this.nowMsValue,
    })
  }

  params(): ReadMilestoneProgressParams {
    return new ReadMilestoneProgressParams({
      root: MilestoneProgressMother.ROOT, repository: MilestoneProgressMother.REPOSITORY,
      story: MilestoneProgressMother.STORY,
    })
  }
}

describe('ReadMilestoneProgress', () => {
  it('an open issue with no recorded work is a pending line', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = WorkInventoryDouble.notFound()

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.PENDING)
    expect(line.step).toBeNull()
    expect(line.baselineRed).toBe(false)
  })

  it('a closed issue is a delivered line with the pull request of its harvest', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.closedIssue()])
    const pullRequest = { number: 12, url: 'https://github.com/owner/name/pull/12' }
    subject.inventory = new WorkInventoryDouble(Mother.finished(pullRequest))

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.DELIVERED)
    expect(line.pullRequest).toEqual(pullRequest)
  })

  it('an implementing slice answers its step, task X of Y and its current call start', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult())
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.RUNNING)
    expect(line.step).toBe('implement')
    expect(line.task).toBe(2)
    expect(line.totalTasks).toBe(5)
    expect(line.stepStartedAt).toBe('2026-09-25T10:00:00.000Z')
  })

  it('a history entry later than the current call starts the current step', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult())
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([
      Mother.historyEntry('2026-09-25T09:00:00.000Z'), Mother.historyEntry('2026-09-25T10:30:00.000Z'),
    ])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines[0].stepStartedAt).toBe('2026-09-25T10:30:00.000Z')
  })

  it('a slice with a red baseline answers baseline red', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult())
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(true)

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines[0].baselineRed).toBe(true)
  })

  it('an activity that cannot be read leaves the line without last tool and last text', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult())
    subject.activities = ImplementationActivityDouble.failing()
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.RUNNING)
    expect(line.lastToolCall).toBeNull()
    expect(line.lastText).toBeNull()
  })

  it('a planning slice answers the plan step and its call start', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.planning())
    subject.planning = new PlanningActivityDouble(Mother.planningActivity(5 * 60 * 1000))
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.RUNNING)
    expect(line.step).toBe('planning')
    expect(line.stepStartedAt).toBe(new Date(subject.nowMsValue - 5 * 60 * 1000).toISOString())
    expect(line.lastText).toBe('reading the plan')
  })

  it('a planning slice with a finished planning activity has no current step start', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.planning())
    subject.planning = new PlanningActivityDouble(Mother.finishedPlanningActivity())
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines[0].stepStartedAt).toBeNull()
  })

  it('the tasks below the current one are done, the current one runs and the rest wait', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(
      Mother.implementationResult(Mother.implementationStateOf({ task: 2, totalTasks: 3 }))
    )
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const statuses = read.progress!.lines[0].tasks.map((task) => task.status)
    expect(statuses).toEqual([SliceTaskStatus.DONE, SliceTaskStatus.RUNNING, SliceTaskStatus.PENDING])
  })

  it('every task is done once the step moves past starting with no current task', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(
      Mother.implementationResult(ImplementationState.of({
        step: ImplementationStep.COMMIT, task: null, totalTasks: 3, name: null, attempt: 1, discards: 0,
      }))
    )
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const statuses = read.progress!.lines[0].tasks.map((task) => task.status)
    expect(statuses).toEqual([SliceTaskStatus.DONE, SliceTaskStatus.DONE, SliceTaskStatus.DONE])
  })

  it('a task carries the name and ruling recorded in its own history entries', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(
      Mother.implementationResult(Mother.implementationStateOf({ task: 2, totalTasks: 2 }))
    )
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([
      Mother.taskHistoryEntry({
        task: 1, taskName: 'Write the port', ruling: 'approved', writtenAt: '2026-09-25T09:00:00.000Z',
      }),
    ])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const done = read.progress!.lines[0].tasks.find((task) => task.number === 1)!
    expect(done.status).toBe(SliceTaskStatus.DONE)
    expect(done.name).toBe('Write the port')
    expect(done.ruling).toBe('approved')
  })

  it('no total tasks answers no tasks', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult(
      ImplementationState.of({ step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null })
    ))
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines[0].tasks).toEqual([])
  })

  it('a vetoed slice needs the person and its stopped task carries the judge findings', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(
      Mother.vetoed({ task: 2, findings: 'the judge found a missing test', verdict: 'blocked' })
    )
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.NEEDS_PERSON)
    expect(line.attention).toEqual({
      kind: 'veto', task: 2, findings: 'the judge found a missing test', verdict: 'blocked',
    })
    const stopped = line.tasks.find((task) => task.number === 2)!
    expect(stopped.status).toBe(SliceTaskStatus.STOPPED)
    expect(stopped.findings).toBe('the judge found a missing test')
  })

  it('an uncertain slice needs the person with its one recovery action', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(
      Mother.uncertainRecoverable({ action: 'continue', detail: 'resume the recorded call' })
    )
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.NEEDS_PERSON)
    expect(line.attention).toEqual({ kind: 'uncertain', action: 'continue', detail: 'resume the recorded call' })
  })

  it('an implementation read that fails leaves a running line with a partial attention', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new FailingImplementationProgress(
      new ImplementationProgressNotRead('the run file could not be read')
    )
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.RUNNING)
    expect(line.attention).toEqual({ kind: 'partial', detail: 'the run file could not be read' })
    expect(line.tasks).toEqual([])
    expect(line.step).toBeNull()
  })

  it('an unverified delivery leaves a running line with a partial attention and its known state', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())
    subject.implementation = new ImplementationProgressDouble({
      state: Mother.implementationState(),
      delivery: { kind: 'unavailable', detail: 'the pull request could not be confirmed' },
    })
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    subject.history = new ImplementationHistoryDouble([])
    subject.baselines = new SliceBaselinesDouble(false)

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.RUNNING)
    expect(line.attention).toEqual({ kind: 'partial', detail: 'the pull request could not be confirmed' })
    expect(line.step).toBe('implement')
    expect(line.task).toBe(2)
  })

  it('pending and delivered lines carry no attention and no tasks', async () => {
    const pendingSubject = new Subject()
    pendingSubject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    pendingSubject.inventory = WorkInventoryDouble.notFound()
    const pendingLine = (await pendingSubject.query().execute(pendingSubject.params())).progress!.lines[0]
    expect(pendingLine.attention).toBeNull()
    expect(pendingLine.tasks).toEqual([])

    const deliveredSubject = new Subject()
    deliveredSubject.issues = new EpicIssuesDouble([MilestoneProgressMother.closedIssue()])
    deliveredSubject.inventory = new WorkInventoryDouble(Mother.finished(null))
    const deliveredLine = (await deliveredSubject.query().execute(deliveredSubject.params())).progress!.lines[0]
    expect(deliveredLine.attention).toBeNull()
    expect(deliveredLine.tasks).toEqual([])
  })

  it('a closed issue with no recorded work is a delivered line with no pull request', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.closedIssue()])
    subject.inventory = WorkInventoryDouble.notFound()

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.DELIVERED)
    expect(line.pullRequest).toBeNull()
  })

  it('a closed issue whose work still reads as implementing is delivered, never running', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.closedIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.implementing())

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines[0].state).toBe(SliceLineState.DELIVERED)
  })

  it('a closed issue whose recorded work cannot be read is still delivered, with no pull request', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.closedIssue()])
    subject.inventory = new WorkInventoryDouble(new ImplementationProgressNotRead('the harvest journal is corrupt'))

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.DELIVERED)
    expect(line.pullRequest).toBeNull()
  })

  it('each line is read for its own issue and the milestone counts the delivered ones', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([
      MilestoneProgressMother.closedIssue(700),
      MilestoneProgressMother.closedIssue(701),
      MilestoneProgressMother.openIssue(702),
      MilestoneProgressMother.openIssue(703),
    ])
    subject.inventory = WorkInventoryDouble.byIssue(new Map([[703, Mother.implementing(703)]]))
    subject.implementation = new ImplementationProgressDouble(Mother.implementationResult())
    subject.activities = new ImplementationActivityDouble(Mother.activity('2026-09-25T10:00:00.000Z'))
    const history = new ImplementationHistoryDouble([])
    subject.history = history
    const baselines = new SliceBaselinesDouble(false)
    subject.baselines = baselines

    const read = await subject.query().execute(subject.params())

    expect(read.progress!.lines.map((line) => line.state)).toEqual([
      SliceLineState.DELIVERED, SliceLineState.DELIVERED, SliceLineState.PENDING, SliceLineState.RUNNING,
    ])
    expect(read.progress!.delivered()).toBe(2)
    expect(history.asked.map((asked) => asked.issue)).toEqual([703])
    expect(baselines.asked).toEqual([{ root: MilestoneProgressMother.ROOT, issue: 703 }])
  })

  it('a line whose work cannot be read needs the person, and the other lines are still answered', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue(702), MilestoneProgressMother.openIssue(703)])
    subject.inventory = WorkInventoryDouble.byIssue(new Map([
      [703, new ImplementationProgressNotRead('the worktree of #703 is not there')],
    ]))

    const read = await subject.query().execute(subject.params())

    const [pending, unreadable] = read.progress!.lines
    expect(pending.state).toBe(SliceLineState.PENDING)
    expect(unreadable.state).toBe(SliceLineState.NEEDS_PERSON)
    expect(unreadable.attention).toEqual({ kind: 'unreadable', detail: 'the worktree of #703 is not there' })
  })

  it('an uncertain slice whose worktree is gone keeps its recovery action, with no tasks and no baseline', async () => {
    const subject = new Subject()
    subject.issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.inventory = new WorkInventoryDouble(Mother.uncertainRecoverable({ action: 'cleanup', detail: 'clean the failed start' }))
    subject.history = new ImplementationHistoryDouble(new ImplementationProgressNotRead('the worktree is not there'))
    subject.baselines = new SliceBaselinesDouble(new ImplementationProgressNotRead('the worktree is not there'))

    const read = await subject.query().execute(subject.params())

    const line = read.progress!.lines[0]
    expect(line.state).toBe(SliceLineState.NEEDS_PERSON)
    expect(line.attention).toEqual({ kind: 'uncertain', action: 'cleanup', detail: 'clean the failed start' })
    expect(line.tasks).toEqual([])
    expect(line.baselineRed).toBe(false)
  })

  it('a draft spec answers no milestone and reads no issue', async () => {
    const subject = new Subject(MilestoneProgressMother.draftSpec())
    const issues = new EpicIssuesDouble([MilestoneProgressMother.openIssue()])
    subject.issues = issues

    const read = await subject.query().execute(subject.params())

    expect(read.progress).toBeNull()
    expect(issues.asked).toEqual([])
  })
})
