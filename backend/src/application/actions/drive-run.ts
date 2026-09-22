import {
  PlanAgentNotResumed, PlanProgressNotRead, RunNotAdvanced,
} from '../../domain/exceptions.ts'
import type { ClosureAnnouncements } from '../../domain/ports/closure-announcements.ts'
import type { PlanCalls } from '../../domain/ports/plan-calls.ts'
import type { PlanPublication } from '../../domain/ports/plan-publication.ts'
import { RunEstablishment, type RunMachine } from '../../domain/ports/run-machine.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../../domain/value-objects/plan-call.ts'
import type { RunClosure, RunInstruction } from '../../domain/value-objects/run-instruction.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import { EscalationState } from '../../domain/value-objects/slice-escalation.ts'
import { DeliverHeldMessages, DeliverHeldMessagesParams } from './deliver-held-messages.ts'
import { ReadSliceEscalation, ReadSliceEscalationParams } from '../queries/read-slice-escalation.ts'
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
  static readonly BLOCKED_JUDGE = 'blocked-judge'
  static readonly VETOED = 'failed'

  readonly calls: PlanCalls
  readonly publication: PlanPublication
  readonly machine: RunMachine
  readonly step: ExecuteRunInstruction
  readonly messages: DeliverHeldMessages
  readonly escalations: ReadSliceEscalation
  readonly announcements: ClosureAnnouncements | null
  readonly stderr: (line: string) => void
  readonly driving: Map<string, Promise<void>>

  constructor({
    calls, publication, machine, step, messages, escalations,
    announcements = null, stderr = () => undefined,
  }: {
    calls: PlanCalls,
    publication: PlanPublication,
    machine: RunMachine,
    step: ExecuteRunInstruction,
    messages: DeliverHeldMessages,
    escalations: ReadSliceEscalation,
    announcements?: ClosureAnnouncements | null,
    stderr?: (line: string) => void,
  }) {
    this.calls = calls
    this.publication = publication
    this.machine = machine
    this.step = step
    this.messages = messages
    this.escalations = escalations
    this.announcements = announcements
    this.stderr = stderr
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
      await this.messages.execute(new DeliverHeldMessagesParams({ watch: params.watch }))
      if (await this.#waiting(params.watch)) return
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
          await this.#announce(params.watch, instruction.work)
          throw new RunNotAdvanced(instruction.work.detail)
      }
    }
  }

  async #announce(watch: PlanWatch, refused: { closure: RunClosure | null }): Promise<void> {
    const closure = refused.closure
    if (this.announcements === null || closure === null) return
    if (closure.state !== DriveRun.BLOCKED_JUDGE || closure.outcome !== DriveRun.VETOED) return
    await this.#carriesOnWhetherOrNotItArrives(watch, this.announcements.announce({
      repository: watch.repository,
      issue: watch.issue.number,
      task: closure.task,
      findings: closure.findings,
      verdict: closure.verdict,
    }))
  }

  async #carriesOnWhetherOrNotItArrives(watch: PlanWatch, announcing: Promise<boolean>): Promise<void> {
    try {
      if (await announcing) return
      this.stderr(DriveRun.#unheard(watch, 'no coordinating session was live to be told'))
    } catch (cause) {
      this.stderr(DriveRun.#unheard(watch, cause instanceof Error ? cause.message : String(cause)))
    }
  }

  static #unheard(watch: PlanWatch, why: string): string {
    return `drive run: ${watch.repository.text}#${watch.issue.number} closed at ${DriveRun.BLOCKED_JUDGE} `
      + `and the closure was not announced: ${why}\n`
  }

  async #waiting(watch: PlanWatch): Promise<boolean> {
    const root = watch.located.root
    if (root === undefined) return false
    const read = await this.escalations.execute(new ReadSliceEscalationParams({
      root: new CheckoutRoot(root), issue: watch.issue.number,
    }))

    return read.escalation.state === EscalationState.RAISED
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
