import { PlanAgentNotResumed } from '../../domain/exceptions.ts'
import type { PlanCalls } from '../../domain/ports/plan-calls.ts'
import type { PlanPublication } from '../../domain/ports/plan-publication.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../../domain/value-objects/plan-call.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'

export class ContinuePlanParams {
  readonly watch: PlanWatch
  readonly call: StartedPlanCall

  constructor({ watch, call }: { watch: PlanWatch, call: StartedPlanCall }) {
    this.watch = watch
    this.call = call
    Object.freeze(this)
  }
}

export class ContinuePlan {
  readonly calls: PlanCalls
  readonly publication: PlanPublication
  readonly continuing: Map<string, Promise<void>>

  constructor({ calls, publication }: { calls: PlanCalls, publication: PlanPublication }) {
    this.calls = calls
    this.publication = publication
    this.continuing = new Map()
  }

  async execute(params: ContinuePlanParams): Promise<void> {
    const existing = this.continuing.get(params.watch.agent)
    if (existing !== undefined) return existing
    const continuing = this.#continue(params)
    this.continuing.set(params.watch.agent, continuing)
    try {
      await continuing
    } finally {
      if (this.continuing.get(params.watch.agent) === continuing) this.continuing.delete(params.watch.agent)
    }
  }

  async #continue(params: ContinuePlanParams): Promise<void> {
    const existing = await this.calls.implementationFor(params.watch)
    if (existing !== null) {
      ContinuePlan.#requireSuccess(await this.calls.wait(existing))
      return
    }
    const plan = await this.calls.wait(params.call)
    ContinuePlan.#requireSuccess(plan)
    await this.#publish(params.watch)
    const implementation = await this.calls.start(
      params.watch,
      'implementation',
      null,
      `implementation:${params.call.id}`,
    )
    ContinuePlan.#requireSuccess(await this.calls.wait(implementation))
  }

  async #publish(watch: PlanWatch): Promise<void> {
    try {
      await this.publication.publish(watch)
    } catch (cause) {
      throw new PlanAgentNotResumed(cause instanceof Error ? cause.message : String(cause))
    }
  }

  static #requireSuccess(completed: CompletedPlanCall): void {
    if (completed.succeeded) return
    if (completed.execution.kind === 'success') {
      throw new PlanAgentNotResumed(`call ${completed.call.id} did not exit successfully`)
    }
    throw new PlanAgentNotResumed(completed.execution.diagnostic)
  }
}
