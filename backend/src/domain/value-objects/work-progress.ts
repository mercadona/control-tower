import type { ImplementationState } from './implementation-state.ts'
import type { PlanningActivity } from './planning-activity.ts'
import type { PlanStateValue } from './plan-state.ts'
import type { PlanWatch } from './plan-watch.ts'
import type { WorkCondition } from './tracked-work.ts'

export type WorkReading<T> =
  | { readonly kind: 'available', readonly value: T }
  | { readonly kind: 'unavailable', readonly detail: string }

export type WorkExecutionReading = WorkReading<ImplementationState>
  | { readonly kind: 'partial', readonly value: ImplementationState, readonly detail: string }

export type WorkProgressDetail =
  | { readonly phase: 'planning', readonly plan: WorkReading<PlanStateValue>, readonly activity: WorkReading<PlanningActivity> }
  | { readonly phase: 'implementing', readonly execution: WorkExecutionReading }
  | (Omit<Extract<WorkCondition, { phase: 'uncertain' }>, 'execution'> & { readonly execution: WorkExecutionReading })

export class WorkProgress {
  readonly watch: PlanWatch
  readonly detail: WorkProgressDetail

  constructor(watch: PlanWatch, detail: WorkProgressDetail) {
    this.watch = watch
    this.detail = Object.freeze(detail)
    Object.freeze(this)
  }
}
