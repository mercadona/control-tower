import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from '../value-objects/plan-call.ts'
import type { PlanNonLaunch } from '../value-objects/plan-non-launch.ts'
import type { UnusedWorkspace } from '../value-objects/unused-workspace.ts'

export type RecoveryDecision =
  | { readonly action: 'observe' | 'continue', readonly detail: string, readonly call: StartedPlanCall }
  | { readonly action: 'cleanup' | 'inspect', readonly detail: string }

export type RecoveryCall = {
  readonly call: StartedPlanCall,
  readonly purpose: PlanCallPurpose,
  readonly startedAt: string,
  readonly deadlineMs: number,
  readonly completion: CompletedPlanCall | null,
}

export class PlanRecovery {
  readonly decision: Readonly<RecoveryDecision>
  readonly #purposes: ReadonlyMap<string, PlanCallPurpose>
  readonly #calls: readonly RecoveryCall[]

  private constructor(decision: RecoveryDecision, calls: readonly RecoveryCall[]) {
    this.decision = Object.freeze({ ...decision })
    this.#purposes = new Map(calls.map((fact) => [fact.call.id, fact.purpose]))
    this.#calls = calls
    Object.freeze(this)
  }

  static from(facts: {
    calls: readonly RecoveryCall[],
    proof: PlanNonLaunch | null,
    cleanup: UnusedWorkspace | null,
    nowMs: number,
  }): PlanRecovery {
    const calls = Object.freeze([...facts.calls])
    const conflict = PlanRecovery.#conflictIn(calls, facts.cleanup, facts.proof)
    if (conflict !== null) return new PlanRecovery({ action: 'inspect', detail: conflict }, calls)
    if (facts.proof !== null) {
      const detail = facts.cleanup === null
        ? 'definite initial non-launch is recorded; checked cleanup is available'
        : 'checked cleanup is incomplete; retry the recorded cleanup'
      return new PlanRecovery({ action: 'cleanup', detail }, calls)
    }

    const implementation = calls.find((fact) => fact.purpose === 'implementation') ?? null
    const fixes = calls.filter((fact) => fact.purpose === 'fix').sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    const target = fixes[0] ?? implementation
    if (target !== null) return new PlanRecovery(PlanRecovery.#executionDecision(target, facts.nowMs), calls)

    const planners = calls.filter((fact) => fact.purpose === 'plan')
    if (planners.length === 0) {
      return new PlanRecovery({ action: 'inspect', detail: 'no call descriptor is recorded; launch outcome is uncertain' }, calls)
    }
    const planner = planners[0]
    if (planner.completion === null) {
      return new PlanRecovery(
        facts.nowMs < planner.deadlineMs
          ? { action: 'observe', detail: `planner call ${planner.call.id} is incomplete within its recorded deadline`, call: planner.call }
          : { action: 'inspect', detail: `planner call ${planner.call.id} is incomplete after its recorded deadline` },
        calls,
      )
    }
    if (!planner.completion.succeeded) {
      return new PlanRecovery({ action: 'inspect', detail: PlanRecovery.#failureOf(planner) }, calls)
    }
    return new PlanRecovery({
      action: 'continue',
      detail: `planner call ${planner.call.id} completed; publication and continuation remain pending`,
      call: planner.call,
    }, calls)
  }

  purposeOf(call: StartedPlanCall): PlanCallPurpose {
    const purpose = this.#purposes.get(call.id)
    if (purpose === undefined) throw new Error(`call ${call.id} is not part of this recovery decision`)
    return purpose
  }

  successfulExecution(): RecoveryCall | null {
    const executions = this.#calls
      .filter((fact) => fact.purpose !== 'plan' && fact.completion?.succeeded === true)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    const selected = executions[0] ?? null
    if (selected === null || this.decision.action !== 'inspect') return null
    return this.decision.detail === `${selected.purpose} call ${selected.call.id} completed and must not be replayed`
      ? selected
      : null
  }

  static #conflictIn(
    calls: readonly RecoveryCall[],
    cleanup: UnusedWorkspace | null,
    proof: PlanNonLaunch | null,
  ): string | null {
    if (cleanup !== null && proof === null) return 'cleanup evidence exists without definite initial non-launch proof'
    if (calls.filter((fact) => fact.purpose === 'plan').length > 1) return 'multiple planner calls are recorded'
    if (calls.filter((fact) => fact.purpose === 'implementation').length > 1) {
      return 'multiple implementation calls are recorded'
    }
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

  static #executionDecision(fact: RecoveryCall, nowMs: number): RecoveryDecision {
    if (fact.completion === null) {
      return nowMs < fact.deadlineMs
        ? { action: 'observe', detail: `${fact.purpose} call ${fact.call.id} is incomplete within its recorded deadline`, call: fact.call }
        : { action: 'inspect', detail: `${fact.purpose} call ${fact.call.id} is incomplete after its recorded deadline` }
    }
    if (!fact.completion.succeeded) return { action: 'inspect', detail: PlanRecovery.#failureOf(fact) }
    return { action: 'inspect', detail: `${fact.purpose} call ${fact.call.id} completed and must not be replayed` }
  }

  static #failureOf(fact: RecoveryCall): string {
    const completed = fact.completion!
    return completed.execution.kind === 'success'
      ? `${fact.purpose} call ${fact.call.id} did not exit successfully`
      : completed.execution.diagnostic
  }
}
