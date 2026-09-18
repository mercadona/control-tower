import {
  PlanAgentNotResumed, PlanProgressNotRead, RunNotAdvanced,
} from '../../domain/exceptions.ts'
import type { PlanCalls } from '../../domain/ports/plan-calls.ts'
import type { PlanPublication } from '../../domain/ports/plan-publication.ts'
import { RunEstablishment, type RunMachine } from '../../domain/ports/run-machine.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../../domain/value-objects/plan-call.ts'
import type { RunInstruction } from '../../domain/value-objects/run-instruction.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import { ExecuteRunInstruction, ExecuteRunInstructionParams } from './execute-run-instruction.ts'

export class DriveRunParams {
  readonly watch: PlanWatch
  readonly planner: StartedPlanCall

  constructor({ watch, planner }: { watch: PlanWatch, planner: StartedPlanCall }) {
    this.watch = watch
    this.planner = planner
    Object.freeze(this)
  }
}

export class DriveRun {
  readonly calls: PlanCalls
  readonly publication: PlanPublication
  readonly machine: RunMachine
  readonly step: ExecuteRunInstruction
  readonly driving: Map<string, Promise<void>>

  constructor({ calls, publication, machine, step }: {
    calls: PlanCalls,
    publication: PlanPublication,
    machine: RunMachine,
    step: ExecuteRunInstruction,
  }) {
    this.calls = calls
    this.publication = publication
    this.machine = machine
    this.step = step
    this.driving = new Map()
  }

  async execute(params: DriveRunParams): Promise<void> {
    const existing = this.driving.get(params.watch.agent)
    if (existing !== undefined) return existing
    const driving = this.#drive(params)
    this.driving.set(params.watch.agent, driving)
    try {
      await driving
    } finally {
      if (this.driving.get(params.watch.agent) === driving) this.driving.delete(params.watch.agent)
    }
  }

  async #drive(params: DriveRunParams): Promise<void> {
    const establishment = await this.machine.establishment(params.watch)
    switch (establishment) {
      case RunEstablishment.ABSENT:
        DriveRun.#requireSuccess(await this.calls.wait(params.planner))
        await this.#publish(params.watch)
        break
      case RunEstablishment.ESTABLISHED:
        break
    }

    let instruction = await this.machine.open(params.watch)
    while (true) {
      instruction = await this.step.execute(new ExecuteRunInstructionParams({
        watch: params.watch,
        instruction,
      }))
      switch (instruction.work.kind) {
        case 'call':
        case 'command':
          break
        case 'delivered':
          return
        case 'refused':
          throw new RunNotAdvanced(instruction.work.detail)
      }
    }
  }

  async #publish(watch: PlanWatch): Promise<void> {
    try {
      await this.publication.publish(watch)
    } catch (cause) {
      if (!(cause instanceof PlanProgressNotRead)) throw cause
      throw new PlanAgentNotResumed(cause.message)
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
