import type { StartedPlanCall } from '../value-objects/plan-call.ts'
import type { PlanNonLaunch } from '../value-objects/plan-non-launch.ts'
import { RecoveryCall } from '../value-objects/recovery-call.ts'
import type { UnusedWorkspace } from '../value-objects/unused-workspace.ts'

type RecoverySelection =
  | { readonly kind: 'cleanup'; readonly partial: boolean }
  | { readonly kind: 'observe' | 'continue' | 'completed'; readonly selected: RecoveryCall }
  | { readonly kind: 'inspect'; readonly reason: string }

export class PlanRecovery {
  readonly #selection: RecoverySelection
  readonly #purposes: ReadonlyMap<string, RecoveryCall['purpose']>

  private constructor(selection: RecoverySelection, calls: readonly RecoveryCall[]) {
    this.#selection = Object.freeze({ ...selection })
    this.#purposes = new Map(calls.map((fact) => [fact.call.id, fact.purpose]))
    Object.freeze(this)
  }

  get action(): 'observe' | 'continue' | 'cleanup' | 'inspect' {
    switch (this.#selection.kind) {
      case 'cleanup':
      case 'observe':
      case 'continue':
        return this.#selection.kind
      case 'completed':
      case 'inspect':
        return 'inspect'
    }
  }

  get detail(): string {
    switch (this.#selection.kind) {
      case 'cleanup':
        return this.#selection.partial
          ? 'checked cleanup is incomplete; retry the recorded cleanup'
          : 'definite initial non-launch is recorded; checked cleanup is available'
      case 'observe':
        return `${this.#selection.selected.purpose} call ${this.#selection.selected.call.id} is incomplete within its recorded deadline`
      case 'continue':
        return `planner call ${this.#selection.selected.call.id} completed; publication and continuation remain pending`
      case 'completed':
        return `${this.#selection.selected.purpose} call ${this.#selection.selected.call.id} completed and must not be replayed`
      case 'inspect':
        return this.#selection.reason
    }
  }

  static from(facts: {
    calls: readonly RecoveryCall[],
    proof: PlanNonLaunch | null,
    cleanup: UnusedWorkspace | null,
    nowMs: number,
  }): PlanRecovery {
    const calls = Object.freeze([...facts.calls])
    const conflict = PlanRecovery.#conflictIn(calls, facts.cleanup, facts.proof)
    if (conflict !== null) return new PlanRecovery({ kind: 'inspect', reason: conflict }, calls)
    if (facts.proof !== null) return new PlanRecovery({ kind: 'cleanup', partial: facts.cleanup !== null }, calls)

    const implementation = calls.find((fact) => fact.purpose === 'implementation') ?? null
    const fixes = calls.filter((fact) => fact.purpose === 'fix').sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    const target = fixes[0] ?? implementation
    if (target !== null) return new PlanRecovery(PlanRecovery.#executionSelection(target, facts.nowMs), calls)

    const planners = calls.filter((fact) => fact.purpose === 'plan')
    if (planners.length === 0) {
      return new PlanRecovery({ kind: 'inspect', reason: 'no call descriptor is recorded; launch outcome is uncertain' }, calls)
    }
    const planner = planners[0]
    if (planner.completion === null) {
      return new PlanRecovery(
        facts.nowMs < planner.deadlineMs
          ? { kind: 'observe', selected: planner }
          : { kind: 'inspect', reason: `planner call ${planner.call.id} is incomplete after its recorded deadline` },
        calls,
      )
    }
    if (!planner.completion.succeeded) {
      return new PlanRecovery({ kind: 'inspect', reason: PlanRecovery.#failureOf(planner) }, calls)
    }
    return new PlanRecovery({ kind: 'continue', selected: planner }, calls)
  }

  call(): StartedPlanCall {
    if (this.#selection.kind === 'observe' || this.#selection.kind === 'continue') {
      return this.#selection.selected.call
    }
    throw new Error(`${this.action} recovery does not select an observable call`)
  }

  purposeOf(call: StartedPlanCall): RecoveryCall['purpose'] {
    const purpose = this.#purposes.get(call.id)
    if (purpose === undefined) throw new Error(`call ${call.id} is not part of this recovery decision`)
    return purpose
  }

  successfulExecution(): RecoveryCall | null {
    return this.#selection.kind === 'completed' ? this.#selection.selected : null
  }

  static #conflictIn(
    calls: readonly RecoveryCall[],
    cleanup: UnusedWorkspace | null,
    proof: PlanNonLaunch | null,
  ): string | null {
    if (cleanup !== null && proof === null) return 'cleanup evidence exists without definite initial non-launch proof'
    if (calls.filter((fact) => fact.purpose === 'plan').length > 1) return 'multiple planner calls are recorded'
    if (calls.filter((fact) => fact.purpose === 'implementation').length > 1) return 'multiple implementation calls are recorded'
    if (calls.filter((fact) => fact.completion === null).length > 1) return 'multiple unfinished calls are recorded'
    const timestamps = new Set<string>()
    for (const fact of calls) {
      if (timestamps.has(fact.startedAt)) return `calls recorded at ${fact.startedAt} carry ambiguous evidence`
      timestamps.add(fact.startedAt)
    }
    if (proof !== null && calls.some((fact) => fact.completion?.succeeded === true)) {
      return 'definite non-launch proof conflicts with a successful call completion'
    }
    return null
  }

  static #executionSelection(fact: RecoveryCall, nowMs: number): RecoverySelection {
    if (fact.completion === null) {
      return nowMs < fact.deadlineMs
        ? { kind: 'observe', selected: fact }
        : { kind: 'inspect', reason: `${fact.purpose} call ${fact.call.id} is incomplete after its recorded deadline` }
    }
    if (!fact.completion.succeeded) return { kind: 'inspect', reason: PlanRecovery.#failureOf(fact) }
    return { kind: 'completed', selected: fact }
  }

  static #failureOf(fact: RecoveryCall): string {
    const completed = fact.completion!
    return completed.execution.kind === 'success'
      ? `${fact.purpose} call ${fact.call.id} did not exit successfully`
      : completed.execution.diagnostic
  }
}
