import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'
import type { EpicSpecs } from '../../domain/ports/epic-specs.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { WorkInventory } from '../../domain/ports/work-inventory.ts'
import type { PlanningActivities } from '../../domain/ports/planning-activity.ts'
import type { ImplementationActivities } from '../../domain/ports/implementation-activities.ts'
import type { ImplementationHistory } from '../../domain/ports/implementation-history.ts'
import type { SliceBaselines } from '../../domain/ports/slice-baselines.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'
import type { ImplementationActivity } from '../../domain/value-objects/implementation-activity.ts'
import type { ImplementationHistoryEntry } from '../../domain/value-objects/implementation-history-entry.ts'
import type { PlanningActivity } from '../../domain/value-objects/planning-activity.ts'
import type { ImplementationState } from '../../domain/value-objects/implementation-state.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import type { TrackedWork, WorkCondition } from '../../domain/value-objects/tracked-work.ts'
import type { RunClosure } from '../../domain/value-objects/run-instruction.ts'
import { PlanningActivityState } from '../../domain/value-objects/planning-activity.ts'
import { MilestoneProgress } from '../../domain/value-objects/milestone-progress.ts'
import { SliceLine, SliceLineState, type SliceAttention } from '../../domain/value-objects/slice-line.ts'
import { SliceTask } from '../../domain/value-objects/slice-task.ts'
import { EpicIssuesNotRead, PlanFailure, WorkNotFound } from '../../domain/exceptions.ts'
import { ReadImplementationProgressParams, type ReadImplementationProgress } from './read-implementation-progress.ts'
import { DriveRun } from '../actions/drive-run.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }
type UncertainCondition = Extract<WorkCondition, { phase: 'uncertain' }>

export class ReadMilestoneProgressParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName
  readonly story: UserStoryKey | UserStoryUrl

  constructor({ root, repository, story }: {
    root: CheckoutRoot, repository: RepositoryName, story: UserStoryKey | UserStoryUrl,
  }) {
    this.root = root
    this.repository = repository
    this.story = story
    Object.freeze(this)
  }
}

export class MilestoneProgressRead {
  readonly progress: MilestoneProgress | null

  constructor(progress: MilestoneProgress | null) {
    this.progress = progress
    Object.freeze(this)
  }
}

export class ReadMilestoneProgress {
  readonly specs: EpicSpecs
  readonly issues: EpicIssues
  readonly inventory: WorkInventory
  readonly implementation: Pick<ReadImplementationProgress, 'execute'>
  readonly planning: PlanningActivities
  readonly activities: ImplementationActivities
  readonly history: ImplementationHistory
  readonly baselines: SliceBaselines
  readonly nowMs: () => number

  constructor({ specs, issues, inventory, implementation, planning, activities, history, baselines, nowMs }: {
    specs: EpicSpecs,
    issues: EpicIssues,
    inventory: WorkInventory,
    implementation: Pick<ReadImplementationProgress, 'execute'>,
    planning: PlanningActivities,
    activities: ImplementationActivities,
    history: ImplementationHistory,
    baselines: SliceBaselines,
    nowMs: () => number,
  }) {
    this.specs = specs
    this.issues = issues
    this.inventory = inventory
    this.implementation = implementation
    this.planning = planning
    this.activities = activities
    this.history = history
    this.baselines = baselines
    this.nowMs = nowMs
  }

  async execute(params: ReadMilestoneProgressParams): Promise<MilestoneProgressRead> {
    const spec = await this.specs.of({ root: params.root, story: params.story })
    if (spec === null || !spec.isFrozen()) return new MilestoneProgressRead(null)
    const milestone = spec.title()!
    const holding = await this.issues.listOf({ repository: params.repository, milestone })
    if (!holding.exhausted) throw new EpicIssuesNotRead(holding.reason!)
    const lines = await Promise.all(holding.issues.map((issue) => this.#lineFor(issue, params)))

    return new MilestoneProgressRead(new MilestoneProgress({ milestone, lines }))
  }

  async #lineFor(issue: EpicIssue, params: ReadMilestoneProgressParams): Promise<SliceLine> {
    const work = await this.#workFor(issue, params)
    if (!issue.isOpen) {
      const pullRequest = work !== null && work.condition.phase === 'finished' ? work.condition.pullRequest : null
      return ReadMilestoneProgress.#delivered(issue, pullRequest)
    }
    if (work === null) return ReadMilestoneProgress.#pending(issue)
    switch (work.condition.phase) {
      case 'finished':
        return ReadMilestoneProgress.#delivered(issue, work.condition.pullRequest)
      case 'planning':
        return this.#planning(issue, work.watch, params)
      case 'implementing':
        return this.#implementing(issue, work.watch, params)
      case 'uncertain':
        return this.#uncertain(issue, work.condition, params)
    }
  }

  async #workFor(issue: EpicIssue, params: ReadMilestoneProgressParams): Promise<TrackedWork | null> {
    try {
      return await this.inventory.find(issue.number, params.repository)
    } catch (cause) {
      if (!(cause instanceof WorkNotFound)) throw cause
      return null
    }
  }

  static #pending(issue: EpicIssue): SliceLine {
    return new SliceLine({
      issue, state: SliceLineState.PENDING, step: null, task: null, totalTasks: null,
      stepStartedAt: null, lastToolCall: null, lastText: null, pullRequest: null, baselineRed: false,
      attention: null, tasks: [],
    })
  }

  static #delivered(issue: EpicIssue, pullRequest: ReviewedPullRequest | null): SliceLine {
    return new SliceLine({
      issue, state: SliceLineState.DELIVERED, step: null, task: null, totalTasks: null,
      stepStartedAt: null, lastToolCall: null, lastText: null, pullRequest, baselineRed: false,
      attention: null, tasks: [],
    })
  }

  async #planning(issue: EpicIssue, watch: PlanWatch, params: ReadMilestoneProgressParams): Promise<SliceLine> {
    const activity = await this.#planningActivityFor(watch)
    const stepStartedAt = activity !== null && activity.state === PlanningActivityState.RUNNING
      ? new Date(this.nowMs() - activity.runningMs).toISOString()
      : null
    const baselineRed = await this.baselines.isRed({ root: params.root, issue: issue.number })

    return new SliceLine({
      issue, state: SliceLineState.RUNNING, step: SliceLine.PLAN_STEP, task: null, totalTasks: null,
      stepStartedAt, lastToolCall: activity?.lastToolCall ?? null, lastText: activity?.lastText ?? null,
      pullRequest: null, baselineRed, attention: null, tasks: [],
    })
  }

  async #implementing(issue: EpicIssue, watch: PlanWatch, params: ReadMilestoneProgressParams): Promise<SliceLine> {
    const outcome = await this.#implementationOutcome(issue, params)
    const activity = await this.#implementationActivityFor(watch)
    const entries = await this.history.of({ root: params.root, issue: issue.number, repository: params.repository })
    const stepStartedAt = ReadMilestoneProgress.#laterOf(
      activity?.startedAt ?? null, ReadMilestoneProgress.#latestWrittenAt(entries)
    )
    const baselineRed = await this.baselines.isRed({ root: params.root, issue: issue.number })
    const tasks = SliceTask.listOf({ state: outcome.state, entries, veto: null })

    return new SliceLine({
      issue, state: SliceLineState.RUNNING, step: outcome.state?.step ?? null,
      task: outcome.state?.task ?? null, totalTasks: outcome.state?.totalTasks ?? null, stepStartedAt,
      lastToolCall: activity?.lastToolCall ?? null, lastText: activity?.lastText ?? null,
      pullRequest: outcome.state?.pullRequest ?? null, baselineRed, attention: outcome.attention, tasks,
    })
  }

  async #implementationOutcome(
    issue: EpicIssue, params: ReadMilestoneProgressParams
  ): Promise<{ state: ImplementationState | null, attention: SliceAttention | null }> {
    let result: Awaited<ReturnType<typeof this.implementation.execute>>
    try {
      result = await this.implementation.execute(new ReadImplementationProgressParams({
        root: params.root, issue: issue.number, repository: params.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause

      return { state: null, attention: { kind: 'partial', detail: cause.message } }
    }
    if (result.delivery.kind === 'unavailable') {
      return { state: result.state, attention: { kind: 'partial', detail: result.delivery.detail } }
    }

    return { state: result.state, attention: null }
  }

  async #uncertain(
    issue: EpicIssue, condition: UncertainCondition, params: ReadMilestoneProgressParams,
  ): Promise<SliceLine> {
    const veto = ReadMilestoneProgress.#vetoOf(condition.refusal)
    const attention: SliceAttention = veto !== null
      ? { kind: 'veto', task: veto.task, findings: veto.findings, verdict: veto.verdict }
      : { kind: 'uncertain', action: condition.recovery.action, detail: condition.recovery.detail }
    const entries = await this.history.of({ root: params.root, issue: issue.number, repository: params.repository })
    const tasks = SliceTask.listOf({ state: condition.execution, entries, veto })
    const baselineRed = await this.baselines.isRed({ root: params.root, issue: issue.number })

    return new SliceLine({
      issue, state: SliceLineState.NEEDS_PERSON,
      step: condition.execution?.step ?? null, task: condition.execution?.task ?? null,
      totalTasks: condition.execution?.totalTasks ?? null,
      stepStartedAt: null, lastToolCall: null, lastText: null,
      pullRequest: condition.execution?.pullRequest ?? null, baselineRed, attention, tasks,
    })
  }

  static #vetoOf(refusal: RunClosure | null): RunClosure | null {
    return refusal !== null && refusal.state === DriveRun.BLOCKED_JUDGE ? refusal : null
  }

  async #planningActivityFor(watch: PlanWatch): Promise<PlanningActivity | null> {
    try {
      return await this.planning.of(watch)
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      return null
    }
  }

  async #implementationActivityFor(watch: PlanWatch): Promise<ImplementationActivity | null> {
    try {
      return await this.activities.of(watch)
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      return null
    }
  }

  static #laterOf(a: string | null, b: string | null): string | null {
    if (a === null) return b
    if (b === null) return a
    return Date.parse(a) >= Date.parse(b) ? a : b
  }

  static #latestWrittenAt(entries: readonly ImplementationHistoryEntry[]): string | null {
    return entries.reduce<string | null>((latest, entry) => {
      if (entry.writtenAt === null) return latest
      if (latest === null) return entry.writtenAt
      return Date.parse(entry.writtenAt) > Date.parse(latest) ? entry.writtenAt : latest
    }, null)
  }
}
