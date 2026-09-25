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
import type { TrackedWork } from '../../domain/value-objects/tracked-work.ts'
import { PlanningActivityState } from '../../domain/value-objects/planning-activity.ts'
import { MilestoneProgress } from '../../domain/value-objects/milestone-progress.ts'
import { SliceLine, SliceLineState } from '../../domain/value-objects/slice-line.ts'
import { EpicIssuesNotRead, PlanFailure, WorkNotFound } from '../../domain/exceptions.ts'
import { ReadImplementationProgressParams, type ReadImplementationProgress } from './read-implementation-progress.ts'

type ReviewedPullRequest = { readonly number: number, readonly url: string }

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
        return this.#uncertain(issue, work.condition.execution, params)
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
    })
  }

  static #delivered(issue: EpicIssue, pullRequest: ReviewedPullRequest | null): SliceLine {
    return new SliceLine({
      issue, state: SliceLineState.DELIVERED, step: null, task: null, totalTasks: null,
      stepStartedAt: null, lastToolCall: null, lastText: null, pullRequest, baselineRed: false,
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
      pullRequest: null, baselineRed,
    })
  }

  async #implementing(issue: EpicIssue, watch: PlanWatch, params: ReadMilestoneProgressParams): Promise<SliceLine> {
    const result = await this.implementation.execute(new ReadImplementationProgressParams({
      root: params.root, issue: issue.number, repository: params.repository,
    }))
    const activity = await this.#implementationActivityFor(watch)
    const entries = await this.history.of({ root: params.root, issue: issue.number, repository: params.repository })
    const stepStartedAt = ReadMilestoneProgress.#laterOf(
      activity?.startedAt ?? null, ReadMilestoneProgress.#latestWrittenAt(entries)
    )
    const baselineRed = await this.baselines.isRed({ root: params.root, issue: issue.number })

    return new SliceLine({
      issue, state: SliceLineState.RUNNING, step: result.state.step,
      task: result.state.task, totalTasks: result.state.totalTasks, stepStartedAt,
      lastToolCall: activity?.lastToolCall ?? null, lastText: activity?.lastText ?? null,
      pullRequest: result.state.pullRequest, baselineRed,
    })
  }

  async #uncertain(
    issue: EpicIssue, execution: ImplementationState | null, params: ReadMilestoneProgressParams,
  ): Promise<SliceLine> {
    const baselineRed = await this.baselines.isRed({ root: params.root, issue: issue.number })

    return new SliceLine({
      issue, state: SliceLineState.NEEDS_PERSON,
      step: execution?.step ?? null, task: execution?.task ?? null, totalTasks: execution?.totalTasks ?? null,
      stepStartedAt: null, lastToolCall: null, lastText: null,
      pullRequest: execution?.pullRequest ?? null, baselineRed,
    })
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
