import type { HeldMessage } from '../value-objects/held-message.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export abstract class SliceMessages {
  abstract hold(watch: PlanWatch, text: string): Promise<string>
  abstract pending(watch: PlanWatch): Promise<readonly HeldMessage[]>
  abstract settle(watch: PlanWatch, ticket: string, call: string): Promise<void>
}
