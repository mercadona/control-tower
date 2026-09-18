import type { RunInstruction } from '../value-objects/run-instruction.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export abstract class RunCalls {
  abstract perform(watch: PlanWatch, instruction: RunInstruction): Promise<void>
}
