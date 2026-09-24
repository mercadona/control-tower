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

export type WorkIdentity = { repo: string; issue: number; agent: string }
export type WorkSnapshot = WorkIdentity & { progress: WorkProgress }
export type WorkProgressOutcome =
  | { kind: 'read'; snapshot: WorkSnapshot }
  | { kind: 'not-found'; detail: string }
  | { kind: 'unavailable'; detail: string }

export type WorkProgressRead =
  | { kind: 'connecting' }
  | { kind: 'read'; snapshot: WorkSnapshot }
  | { kind: 'stale'; snapshot: WorkSnapshot; detail: string }
  | { kind: 'unavailable'; detail: string }

export type WorkConclusion =
  | { kind: 'checking' }
  | { kind: 'finished'; harvestedAt: string; pullRequest: DeliveredPullRequest | null }
  | { kind: 'not-found' }
