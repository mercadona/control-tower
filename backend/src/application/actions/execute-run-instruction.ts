import type { RunCalls } from '../../domain/ports/run-calls.ts'
import type { RunMachine } from '../../domain/ports/run-machine.ts'
import type { RunInstruction } from '../../domain/value-objects/run-instruction.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'

export class ExecuteRunInstructionParams {
  readonly watch: PlanWatch
  readonly instruction: RunInstruction

  constructor(asked: { watch: PlanWatch, instruction: RunInstruction }) {
    this.watch = asked.watch
    this.instruction = asked.instruction
    Object.freeze(this)
  }
}

export class ExecuteRunInstruction {
  readonly machine: RunMachine
  readonly calls: RunCalls

  constructor({ machine, calls }: { machine: RunMachine, calls: RunCalls }) {
    this.machine = machine
    this.calls = calls
  }

  async execute(params: ExecuteRunInstructionParams): Promise<RunInstruction> {
    switch (params.instruction.work.kind) {
      case 'call':
        await this.calls.perform(params.watch, params.instruction)
        return this.machine.advance(params.watch, params.instruction)
      case 'command':
        return this.machine.advance(params.watch, params.instruction)
      case 'delivered':
      case 'refused':
        return params.instruction
    }
    return params.instruction.work satisfies never
  }
}
