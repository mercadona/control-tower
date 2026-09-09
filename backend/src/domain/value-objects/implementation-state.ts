export const ImplementationStep = Object.freeze({
  STARTING: 'starting',
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  ADVISE: 'advise',
  COMMIT: 'commit',
  RECONCILE: 'reconcile',
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  E2E: 'e2e',
  DELIVERED: 'delivered',
  IN_REVIEW: 'in-review',
  FIXING: 'fixing',
} as const)

export type ImplementationStepValue = (typeof ImplementationStep)[keyof typeof ImplementationStep]

type ReviewedPullRequest = { readonly number: number, readonly url: string }

type ImplementationStateFields = {
  step: ImplementationStepValue,
  task: number | null,
  totalTasks: number | null,
  name: string | null,
  attempt: number | null,
  discards: number | null,
  pullRequest?: ReviewedPullRequest | null,
}

export class ImplementationState {
  static readonly TASKLESS: readonly ImplementationStepValue[] = Object.freeze([
    ImplementationStep.STARTING, ImplementationStep.RECONCILE, ImplementationStep.GLOBAL,
    ImplementationStep.SLICE_JUDGE, ImplementationStep.E2E, ImplementationStep.DELIVERED,
    ImplementationStep.IN_REVIEW, ImplementationStep.FIXING,
  ])

  readonly step: ImplementationStepValue
  readonly task: number | null
  readonly totalTasks: number | null
  readonly name: string | null
  readonly attempt: number | null
  readonly discards: number | null
  readonly pullRequest: ReviewedPullRequest | null

  constructor({ step, task, totalTasks, name, attempt, discards, pullRequest = null }: ImplementationStateFields) {
    this.step = step
    this.task = task
    this.totalTasks = totalTasks
    this.name = name
    this.attempt = attempt
    this.discards = discards
    this.pullRequest = pullRequest
    Object.freeze(this)
  }

  static of({ step, task, totalTasks, name, attempt, discards, pullRequest = null }: ImplementationStateFields): ImplementationState {
    if (ImplementationState.TASKLESS.includes(step)) {
      return new ImplementationState({
        step, task: null, totalTasks, name: null, attempt: null, discards, pullRequest,
      })
    }
    return new ImplementationState({ step, task, totalTasks, name, attempt, discards, pullRequest })
  }

  underReview({ step, pullRequest }: {
    step: ImplementationStepValue,
    pullRequest: ReviewedPullRequest | null,
  }): ImplementationState {
    return ImplementationState.of({
      step, task: this.task, totalTasks: this.totalTasks, name: this.name,
      attempt: this.attempt, discards: this.discards, pullRequest,
    })
  }

  static starting(): ImplementationState {
    return ImplementationState.of({
      step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null,
    })
  }
}
