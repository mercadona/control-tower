import type { PlanWatch } from './plan-watch.ts'
import type { RunClosure } from './run-instruction.ts'

export type WorkCondition =
  | { readonly phase: 'planning' }
  | { readonly phase: 'implementing', readonly acceptsChange: boolean }
  | {
    readonly phase: 'uncertain',
    readonly diagnostic: string,
    readonly recovery: { readonly action: 'observe' | 'continue' | 'cleanup' | 'inspect', readonly detail: string },
    readonly refusal: RunClosure | null,
  }

export class TrackedWork {
  readonly watch: PlanWatch
  readonly condition: WorkCondition

  constructor(watch: PlanWatch, condition: WorkCondition) {
    this.watch = watch
    this.condition = Object.freeze(condition)
    Object.freeze(this)
  }
}
