import type { CompletedPlanCall, StartedPlanCall } from '../value-objects/plan-call.ts'
import type { RecordedCall } from '../value-objects/recorded-call.ts'

export abstract class AgentCalls<Invocation, Descriptor> {
  abstract start(invocation: Invocation): Promise<StartedPlanCall>
  abstract startedFor(invocation: Invocation): Promise<StartedPlanCall | null>
  abstract wait(call: StartedPlanCall): Promise<CompletedPlanCall>
  abstract completed(call: StartedPlanCall): Promise<CompletedPlanCall | null>
  abstract history(conversation: string): Promise<readonly RecordedCall[]>
  abstract recover(conversation: string): Promise<readonly RecordedCall[]>
  abstract descriptorOf(call: StartedPlanCall): Promise<Descriptor>
  abstract deadlineOf(call: StartedPlanCall): Promise<number>
  abstract owns(call: StartedPlanCall): boolean
}
