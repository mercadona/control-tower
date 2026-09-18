import type { RunInstruction } from '../value-objects/run-instruction.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'

export const RunEstablishment: Readonly<{ ABSENT: 'absent'; ESTABLISHED: 'established' }> = Object.freeze({
  ABSENT: 'absent',
  ESTABLISHED: 'established',
})

export type RunEstablishmentValue = typeof RunEstablishment[keyof typeof RunEstablishment]

export abstract class RunMachine {
  abstract establishment(watch: PlanWatch): Promise<RunEstablishmentValue>
  abstract open(watch: PlanWatch): Promise<RunInstruction>
  abstract advance(watch: PlanWatch, instruction: RunInstruction): Promise<RunInstruction>
}
