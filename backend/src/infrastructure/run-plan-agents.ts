import { DriveRunParams, type DriveRun } from '../application/actions/drive-run.ts'
import {
  PlanAgentNeverLaunched,
  PlanAgentNotLaunched,
  PlanAgentNotNamed,
  PlanAgentNotResumed,
  PlanRecoveryConflict,
  PlanRecoveryNotFound,
  PlanRecoveryNotRead,
  PlanRecoveryNotUnderstood,
  RunNotAdvanced,
  RunNotUnderstood,
} from '../domain/exceptions.ts'
import { PlanAgents } from '../domain/ports/plan-agents.ts'
import type { PlanCalls } from '../domain/ports/plan-calls.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import { PlanRecovery } from '../domain/policies/plan-recovery.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'
import { RecoveryCall } from '../domain/value-objects/recovery-call.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ClaudeCalls } from './claude-calls.ts'
import type { ClaudeRunMeasurements } from './claude-run-measurements.ts'
import type { CtRunMachine, RunInspection } from './ct-run-machine.ts'
import type { RecordedCall } from './recorded-call.ts'
import type { RunJournal } from './run-journal.ts'

export const RunProvenance: Readonly<{ LEGACY: 'legacy', DRIVER: 'driver' }> = Object.freeze({
  LEGACY: 'legacy',
  DRIVER: 'driver',
})

export type RunProvenanceValue = typeof RunProvenance[keyof typeof RunProvenance]

type LocatedPlan = {
  readonly agent: string,
  readonly issue: number,
  readonly repository: RepositoryName,
}

type FixPlan = LocatedPlan & {
  readonly changes: string,
  readonly requestId?: string,
}

export class RunPlanAgents extends PlanAgents {
  readonly legacy: PlanAgents
  readonly records: PlanRecords
  readonly calls: PlanCalls
  readonly transport: ClaudeCalls
  readonly driver: DriveRun
  readonly machine: CtRunMachine
  readonly journal: RunJournal
  readonly measurements: ClaudeRunMeasurements
  readonly newId: () => string
  readonly nowMs: () => number
  readonly stderr: (line: string) => void
  readonly reservations: Set<string>

  constructor(ports: {
    legacy: PlanAgents,
    records: PlanRecords,
    calls: PlanCalls,
    transport: ClaudeCalls,
    driver: DriveRun,
    machine: CtRunMachine,
    journal: RunJournal,
    measurements: ClaudeRunMeasurements,
    newId: () => string,
    nowMs: () => number,
    stderr: (line: string) => void,
  }) {
    super()
    this.legacy = ports.legacy
    this.records = ports.records
    this.calls = ports.calls
    this.transport = ports.transport
    this.driver = ports.driver
    this.machine = ports.machine
    this.journal = ports.journal
    this.measurements = ports.measurements
    this.newId = ports.newId
    this.nowMs = ports.nowMs
    this.stderr = ports.stderr
    this.reservations = new Set()
  }

  override async launch(briefing: PlanBriefing): Promise<string> {
    const watch = await this.records.prepare(briefing)
    try {
      await this.journal.admit(watch)
    } catch (cause) {
      RunPlanAgents.#throwLaunchFailure(cause)
    }
    let call: StartedPlanCall
    try {
      call = await this.calls.start(watch, 'plan', null)
    } catch (cause) {
      if (!(cause instanceof PlanAgentNeverLaunched)) throw cause
      try {
        await this.records.recordNonLaunch(watch, cause.proof)
      } catch (proofCause) {
        throw new PlanAgentNotLaunched(
          `${cause.message}; non-launch proof could not be recorded: ${String(proofCause)}`,
        )
      }
      throw cause
    }
    if (!this.#claim(watch)) {
      throw new PlanAgentNotLaunched(`conversation ${JSON.stringify(watch.agent)} already has supervised work`)
    }
    this.#supervise(watch, call, this.#driveAfterPlanner(watch, call))
    return watch.agent
  }

  override async resume(asked: LocatedPlan): Promise<void> {
    throw new PlanAgentNotResumed(
      `conversation ${JSON.stringify(asked.agent)} for ${asked.repository.text}#${asked.issue} cannot be resumed directly`,
    )
  }

  override async recover(asked: LocatedPlan): Promise<void> {
    const watch = await this.#recoveryWatch(asked)
    let provenance: RunProvenanceValue
    try {
      provenance = await this.provenance(watch)
    } catch (cause) {
      RunPlanAgents.#throwRecoveryFailure(cause)
    }
    if (provenance === RunProvenance.LEGACY) return this.legacy.recover(asked)
    if (!this.#claim(watch)) return
    let handedOff = false
    try {
      const history = await this.transport.history(watch.agent)
      await this.#captureCompleted(history)
      const inspection = await this.machine.inspect(watch)
      const call = await this.#recoveryCall(watch, inspection, history)
      if (call === null) return
      this.#supervise(watch, call, this.#recoveredWork(watch, inspection, call))
      handedOff = true
    } catch (cause) {
      RunPlanAgents.#throwRecoveryFailure(cause)
    } finally {
      if (!handedOff) this.reservations.delete(watch.agent)
    }
  }

  override async fix(asked: FixPlan): Promise<void> {
    const watch = await this.#fixWatch(asked)
    let provenance: RunProvenanceValue
    try {
      provenance = await this.provenance(watch)
    } catch (cause) {
      RunPlanAgents.#throwFixFailure(cause)
    }
    if (provenance === RunProvenance.LEGACY) return this.legacy.fix(asked)
    try {
      const inspection = await this.machine.inspect(watch)
      if (inspection.fact.kind === 'unstarted' || inspection.fact.kind === 'active') {
        await this.journal.hold(watch, asked.changes)
        await this.#resumeIfNobodyDrives(watch)
        return
      }
      if (inspection.fact.kind !== 'delivered') {
        throw new RunNotAdvanced(
          `conversation ${JSON.stringify(watch.agent)} is ${inspection.fact.kind} rather than delivered`,
        )
      }
    } catch (cause) {
      RunPlanAgents.#throwFixFailure(cause)
    }
    if (!this.#claim(watch)) {
      throw new PlanAgentNotResumed(`conversation ${JSON.stringify(watch.agent)} already has supervised work`)
    }
    let handedOff = false
    try {
      const history = await this.transport.history(watch.agent)
      const existing = await this.#existingFix(history)
      if (existing !== null) {
        this.#supervise(watch, existing, this.#completeFix(existing))
        handedOff = true
        return
      }
      const requestId = asked.requestId ?? this.newId()
      const call = await this.calls.start(watch, 'fix', asked.changes, requestId)
      this.#supervise(watch, call, this.#completeFix(call))
      handedOff = true
    } catch (cause) {
      RunPlanAgents.#throwFixFailure(cause)
    } finally {
      if (!handedOff) this.reservations.delete(watch.agent)
    }
  }

  async #resumeIfNobodyDrives(watch: PlanWatch): Promise<void> {
    if (!this.#claim(watch)) return
    let handedOff = false
    try {
      const planner = await this.calls.planningFor(watch)
      this.#supervise(watch, planner, this.driver.execute(new DriveRunParams({ watch, planner })))
      handedOff = true
    } finally {
      if (!handedOff) this.reservations.delete(watch.agent)
    }
  }

  async #driveAfterPlanner(watch: PlanWatch, call: StartedPlanCall): Promise<void> {
    await this.calls.wait(call)
    await this.measurements.capture(call)
    await this.driver.execute(new DriveRunParams({ watch, planner: call }))
  }

  async #recoveredWork(watch: PlanWatch, inspection: RunInspection, call: StartedPlanCall): Promise<void> {
    if (inspection.fact.kind === 'delivered') return this.#completeFix(call)
    if (inspection.fact.kind === 'absent') return this.#driveAfterPlanner(watch, call)
    await this.driver.execute(new DriveRunParams({ watch, planner: call }))
  }

  async provenance(watch: PlanWatch): Promise<RunProvenanceValue> {
    const admitted = await this.journal.admitted(watch)
    const manifest = await this.journal.manifest(watch)
    const operations = await this.journal.operationsPresent(watch)
    const entries = await this.journal.entries(watch)
    const history = await this.transport.history(watch.agent)
    const planners: RecordedCall[] = []
    const legacyImplementations: RecordedCall[] = []
    const driverImplementations: RecordedCall[] = []
    const unknownImplementations: RecordedCall[] = []
    for (const recorded of history) {
      const descriptor = await this.transport.descriptorOf(recorded.call)
      if (descriptor.cwd !== watch.located.path || descriptor.purpose !== recorded.purpose) {
        throw new PlanRecoveryConflict(`call ${recorded.call.id} is not bound to the recorded plan watch`)
      }
      switch (recorded.purpose) {
        case 'plan':
          if (descriptor.mode() !== 'initial' || descriptor.requestId !== null) {
            throw new PlanRecoveryConflict(`planner call ${recorded.call.id} has conflicting provenance`)
          }
          planners.push(recorded)
          break
        case 'implementation':
          if (descriptor.mode() !== 'resume' || descriptor.requestId === null) {
            unknownImplementations.push(recorded)
          } else if (descriptor.requestId.startsWith('run:')) {
            driverImplementations.push(recorded)
          } else if (descriptor.requestId.startsWith('implementation:')) {
            legacyImplementations.push(recorded)
          } else {
            unknownImplementations.push(recorded)
          }
          break
        case 'fix':
          if (descriptor.mode() !== 'resume' || descriptor.requestId === null) {
            throw new PlanRecoveryConflict(`fix call ${recorded.call.id} has conflicting provenance`)
          }
          break
      }
    }
    const legacy = planners.length === 1
      && legacyImplementations.length === 1
      && driverImplementations.length === 0
      && unknownImplementations.length === 0
      && (await this.transport.descriptorOf(legacyImplementations[0].call)).requestId
        === `implementation:${planners[0].call.id}`
    if (admitted) {
      if (legacyImplementations.length > 0 || unknownImplementations.length > 0) {
        throw new PlanRecoveryConflict(`conversation ${JSON.stringify(watch.agent)} has conflicting driver provenance`)
      }
      return RunProvenance.DRIVER
    }
    if (manifest !== null || operations || entries.length > 0 || driverImplementations.length > 0) {
      throw new PlanRecoveryConflict(
        `conversation ${JSON.stringify(watch.agent)} has driver evidence without admission provenance`,
      )
    }
    if (legacy) return RunProvenance.LEGACY
    try {
      await this.machine.establishment(watch)
    } catch (cause) {
      if (cause instanceof RunNotAdvanced || cause instanceof RunNotUnderstood) {
        throw new PlanRecoveryConflict(cause.message)
      }
      throw cause
    }
    throw new PlanRecoveryConflict(
      history.length === 0
        ? `conversation ${JSON.stringify(watch.agent)} has no durable execution provenance`
        : `conversation ${JSON.stringify(watch.agent)} has unproven call provenance`,
    )
  }

  owns(watch: PlanWatch): boolean {
    return this.reservations.has(watch.agent)
  }

  async #completeFix(call: StartedPlanCall): Promise<void> {
    const completed = await this.calls.wait(call)
    await this.measurements.capture(call)
    RunPlanAgents.#requireSuccess(completed)
  }

  async #captureCompleted(history: readonly RecordedCall[]): Promise<void> {
    for (const recorded of history) {
      if (recorded.completion !== null) await this.measurements.capture(recorded.call)
    }
  }

  async #recoveryCall(
    watch: PlanWatch,
    inspection: RunInspection,
    history: readonly RecordedCall[],
  ): Promise<StartedPlanCall | null> {
    switch (inspection.fact.kind) {
      case 'absent':
        return this.#plannerRecovery(watch)
      case 'unstarted':
        RunPlanAgents.#requireOwnedIncomplete(history, this.transport)
        return this.calls.planningFor(watch)
      case 'uncertain':
        throw new PlanRecoveryConflict(inspection.fact.detail)
      case 'delivered':
        return this.#deliveredFixRecovery(history)
      case 'active':
        if (inspection.fact.instruction.work.kind !== 'call'
          && inspection.fact.instruction.work.kind !== 'command') {
          throw new PlanRecoveryConflict('the active machine instruction cannot be continued')
        }
        RunPlanAgents.#requireOwnedIncomplete(history, this.transport)
        return this.calls.planningFor(watch)
    }
    return inspection.fact satisfies never
  }

  async #plannerRecovery(watch: PlanWatch): Promise<StartedPlanCall> {
    const recovery = await this.calls.recoveryFor(watch)
    switch (recovery.action) {
      case 'cleanup':
      case 'inspect':
        throw new PlanRecoveryConflict(recovery.detail)
      case 'continue':
        return recovery.call()
      case 'observe': {
        const call = recovery.call()
        if (recovery.purposeOf(call) !== 'plan' || !this.transport.owns(call)) {
          throw new PlanRecoveryConflict(`${recovery.detail}; the planner is not owned by this API process`)
        }
        return call
      }
    }
  }

  async #deliveredFixRecovery(history: readonly RecordedCall[]): Promise<StartedPlanCall | null> {
    const fixes = await this.#fixFacts(history)
    if (fixes.length === 0) return null
    const recovery = PlanRecovery.from({ calls: fixes, proof: null, cleanup: null, nowMs: this.nowMs() })
    if (recovery.successfulExecution() !== null) return null
    switch (recovery.action) {
      case 'observe': {
        const call = recovery.call()
        if (!this.transport.owns(call)) {
          throw new PlanRecoveryConflict(`${recovery.detail}; the fix is not owned by this API process`)
        }
        return call
      }
      case 'continue':
      case 'cleanup':
      case 'inspect':
        throw new PlanRecoveryConflict(recovery.detail)
    }
  }

  async #existingFix(history: readonly RecordedCall[]): Promise<StartedPlanCall | null> {
    const fixes = await this.#fixFacts(history)
    if (fixes.length === 0) return null
    const recovery = PlanRecovery.from({ calls: fixes, proof: null, cleanup: null, nowMs: this.nowMs() })
    if (recovery.successfulExecution() !== null) return null
    if (recovery.action === 'observe') {
      const call = recovery.call()
      if (this.transport.owns(call)) return call
    }
    throw new PlanRecoveryConflict(recovery.detail)
  }

  async #fixFacts(history: readonly RecordedCall[]): Promise<readonly RecoveryCall[]> {
    const fixes: RecoveryCall[] = []
    for (const recorded of history) {
      if (recorded.purpose !== 'fix') continue
      fixes.push(new RecoveryCall({
        call: recorded.call,
        purpose: recorded.purpose,
        startedAt: recorded.startedAt,
        deadlineMs: await this.transport.deadlineOf(recorded.call),
        completion: recorded.completion,
      }))
    }
    return Object.freeze(fixes)
  }

  async #recoveryWatch(asked: LocatedPlan): Promise<PlanWatch> {
    let watch: PlanWatch | null
    try {
      watch = await this.records.find({ issue: asked.issue, repository: asked.repository })
    } catch (cause) {
      if (cause instanceof PlanRecoveryNotRead || cause instanceof PlanRecoveryNotUnderstood) throw cause
      if (cause instanceof PlanAgentNotNamed) throw new PlanRecoveryNotUnderstood(cause.message)
      if (cause instanceof PlanAgentNotLaunched) throw new PlanRecoveryNotRead(cause.message)
      throw cause
    }
    if (watch === null) throw new PlanRecoveryNotFound(`no active plan is recorded for ${asked.repository.text}#${asked.issue}`)
    if (watch.agent !== asked.agent) {
      throw new PlanRecoveryConflict(
        `conversation ${JSON.stringify(asked.agent)} is not the recorded plan for ${asked.repository.text}#${asked.issue}`,
      )
    }
    return watch
  }

  async #fixWatch(asked: LocatedPlan): Promise<PlanWatch> {
    const watch = await this.records.find({ issue: asked.issue, repository: asked.repository })
    if (watch === null || watch.agent !== asked.agent) {
      throw new PlanAgentNotResumed(
        `conversation ${JSON.stringify(asked.agent)} is not the recorded plan for ${asked.repository.text}#${asked.issue}`,
      )
    }
    return watch
  }

  #claim(watch: PlanWatch): boolean {
    if (this.reservations.has(watch.agent)) return false
    this.reservations.add(watch.agent)
    return true
  }

  #supervise(watch: PlanWatch, call: StartedPlanCall, work: Promise<void>): void {
    void work.catch((cause: unknown) => {
      this.stderr(
        `run plan agent: ${watch.repository.text}#${watch.issue.number} conversation ${watch.agent} `
        + `call ${call.id} failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      )
    }).finally(() => {
      this.reservations.delete(watch.agent)
    })
  }

  static #requireOwnedIncomplete(history: readonly RecordedCall[], transport: ClaudeCalls): void {
    const unfinished = history.filter((recorded) => recorded.completion === null)
    if (unfinished.length > 1) throw new PlanRecoveryConflict('multiple unfinished calls are recorded')
    if (unfinished.length === 1 && !transport.owns(unfinished[0].call)) {
      throw new PlanRecoveryConflict(
        `incomplete call ${unfinished[0].call.id} is not owned by this API process`,
      )
    }
  }

  static #requireSuccess(completed: CompletedPlanCall): void {
    if (completed.succeeded) return
    if (completed.execution.kind === 'success') {
      throw new PlanAgentNotResumed(`call ${completed.call.id} did not exit successfully`)
    }
    throw new PlanAgentNotResumed(completed.execution.diagnostic)
  }

  static #throwLaunchFailure(cause: unknown): never {
    if (cause instanceof RunNotAdvanced) throw new PlanAgentNotLaunched(cause.message)
    if (cause instanceof RunNotUnderstood) throw new PlanAgentNotNamed(cause.message)
    throw cause
  }

  static #throwRecoveryFailure(cause: unknown): never {
    if (cause instanceof RunNotAdvanced) throw new PlanRecoveryNotRead(cause.message)
    if (cause instanceof RunNotUnderstood) throw new PlanRecoveryNotUnderstood(cause.message)
    if (cause instanceof PlanAgentNotLaunched) throw new PlanRecoveryNotRead(cause.message)
    if (cause instanceof PlanAgentNotNamed) throw new PlanRecoveryNotUnderstood(cause.message)
    throw cause
  }

  static #throwFixFailure(cause: unknown): never {
    if (cause instanceof RunNotAdvanced || cause instanceof RunNotUnderstood || cause instanceof PlanRecoveryConflict
      || cause instanceof PlanAgentNotLaunched || cause instanceof PlanAgentNotNamed) {
      throw new PlanAgentNotResumed(cause.message)
    }
    throw cause
  }
}
