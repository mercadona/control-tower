import { PlanAgentNotResumed } from '../../domain/exceptions.ts'
import type { CallMeasurements } from '../../domain/ports/call-measurements.ts'
import type { PlanCalls } from '../../domain/ports/plan-calls.ts'
import type { SliceMessages } from '../../domain/ports/slice-messages.ts'
import type { CompletedPlanCall } from '../../domain/value-objects/plan-call.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'

export class DeliverHeldMessagesParams {
  readonly watch: PlanWatch

  constructor(asked: { watch: PlanWatch }) {
    this.watch = asked.watch
    Object.freeze(this)
  }
}

export class DeliverHeldMessages {
  static readonly REQUEST_PREFIX = 'message:'

  readonly messages: SliceMessages
  readonly calls: PlanCalls
  readonly measurements: CallMeasurements

  constructor({ messages, calls, measurements }: {
    messages: SliceMessages,
    calls: PlanCalls,
    measurements: CallMeasurements,
  }) {
    this.messages = messages
    this.calls = calls
    this.measurements = measurements
  }

  async execute(params: DeliverHeldMessagesParams): Promise<void> {
    for (const message of await this.messages.pending(params.watch)) {
      const call = await this.calls.start(
        params.watch,
        'fix',
        message.text,
        `${DeliverHeldMessages.REQUEST_PREFIX}${message.ticket}`,
      )
      const completed = await this.calls.wait(call)
      await this.measurements.capture(call)
      DeliverHeldMessages.#requireSuccess(completed)
      await this.messages.settle(params.watch, message.ticket, call.id)
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
