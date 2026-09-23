import { PlanAgentNotResumed } from '../../domain/exceptions.ts'
import type { PlanCalls } from '../../domain/ports/plan-calls.ts'
import type { SliceEscalations } from '../../domain/ports/slice-escalations.ts'
import type { SliceMessages } from '../../domain/ports/slice-messages.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { CompletedPlanCall } from '../../domain/value-objects/plan-call.ts'
import { HeldMessage } from '../../domain/value-objects/held-message.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'

export class DeliverHeldMessagesParams {
  readonly watch: PlanWatch

  constructor(asked: { watch: PlanWatch }) {
    this.watch = asked.watch
    Object.freeze(this)
  }
}

export class DeliverHeldMessages {
  static readonly REQUEST_PREFIX: string = HeldMessage.REQUEST_PREFIX

  readonly messages: SliceMessages
  readonly calls: PlanCalls
  readonly escalations: SliceEscalations

  constructor({ messages, calls, escalations }: {
    messages: SliceMessages,
    calls: PlanCalls,
    escalations: SliceEscalations,
  }) {
    this.messages = messages
    this.calls = calls
    this.escalations = escalations
  }

  async execute(params: DeliverHeldMessagesParams): Promise<void> {
    let delivered = 0
    for (const message of await this.messages.pending(params.watch)) {
      const call = await this.calls.start(
        params.watch,
        'fix',
        message.text,
        `${DeliverHeldMessages.REQUEST_PREFIX}${message.ticket}`,
      )
      const completed = await this.calls.wait(call)
      DeliverHeldMessages.#requireSuccess(completed)
      await this.messages.settle(params.watch, message.ticket, call.id)
      delivered += 1
    }
    if (delivered === 0) return
    const root = params.watch.located.root
    if (root === undefined) return
    await this.escalations.lift({ root: new CheckoutRoot(root), issue: params.watch.issue.number })
  }

  static #requireSuccess(completed: CompletedPlanCall): void {
    if (completed.succeeded) return
    if (completed.execution.kind === 'success') {
      throw new PlanAgentNotResumed(`call ${completed.call.id} did not exit successfully`)
    }
    throw new PlanAgentNotResumed(completed.execution.diagnostic)
  }
}
