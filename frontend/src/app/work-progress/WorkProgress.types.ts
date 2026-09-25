import type { ImplementationProgressState } from 'app/implement-progress/ImplementProgress.types'
import type { PlanningActivity } from 'app/planning-progress/PlanningProgress.types'
import type { PlanRefusal, RecoveryAction } from 'app/active-plans/ActivePlan.types'

export type WorkReading<T> =
  | { kind: 'available'; value: T }
  | { kind: 'unavailable'; detail: string }

export type WorkExecutionReading = WorkReading<ImplementationProgressState>
  | { kind: 'partial'; value: ImplementationProgressState; detail: string }

export type WorkProgress =
  | { phase: 'planning'; plan: WorkReading<'writing' | 'ready'>; activity: WorkReading<PlanningActivity> }
  | { phase: 'implementing'; execution: WorkExecutionReading }
  | { phase: 'uncertain'; diagnostic: string; recovery: { action: RecoveryAction; detail: string }; refusal: PlanRefusal | null; execution: WorkExecutionReading }
  | { phase: 'finished'; harvestedAt: string; pullRequest: DeliveredPullRequest | null }

export type DeliveredPullRequest = { number: number; url: string }

export type WorkSnapshot = { repo: string; issue: number; agent: string; progress: WorkProgress }
