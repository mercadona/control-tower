import { ContinuePlanParams, type ContinuePlan } from '../application/actions/continue-plan.ts'
import {
  PlanAgentNeverLaunched,
  PlanAgentNotLaunched,
  PlanAgentNotNamed,
  PlanAgentNotResumed,
  PlanRecoveryConflict,
  PlanRecoveryNotFound,
  PlanRecoveryNotRead,
  PlanRecoveryNotUnderstood,
} from '../domain/exceptions.ts'
import { PlanAgents } from '../domain/ports/plan-agents.ts'
import type { PlanCalls } from '../domain/ports/plan-calls.ts'
import type { PlanRecords } from '../domain/ports/plan-records.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import type { PlanBriefing } from '../domain/value-objects/plan-briefing.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class HeadlessPlanAgents extends PlanAgents {
  readonly records: PlanRecords
  readonly calls: PlanCalls
  readonly continuation: ContinuePlan
  readonly newId: () => string
  readonly stderr: (line: string) => void

  constructor(ports: {
    records: PlanRecords,
    calls: PlanCalls,
    continuation: ContinuePlan,
    newId: () => string,
    stderr: (line: string) => void,
  }) {
    super()
    this.records = ports.records
    this.calls = ports.calls
    this.continuation = ports.continuation
    this.newId = ports.newId
    this.stderr = ports.stderr
  }

  override async launch(briefing: PlanBriefing): Promise<string> {
    const watch = await this.records.prepare(briefing)
    let call: StartedPlanCall
    try {
      call = await this.calls.start(watch, 'plan', null)
    } catch (cause) {
      if (!(cause instanceof PlanAgentNeverLaunched)) throw cause
      try {
        await this.records.recordNonLaunch(watch, cause.proof)
      } catch (proofCause) {
        throw new PlanAgentNotLaunched(
          `${cause.message}; non-launch proof could not be recorded: ${String(proofCause)}`
        )
      }
      throw cause
    }
    this.#supervise(watch, call, this.continuation.execute(new ContinuePlanParams({ watch, call })))
    return watch.agent
  }

  override async resume(asked: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): Promise<void> {
    throw new PlanAgentNotResumed(
      `conversation ${JSON.stringify(asked.agent)} for ${asked.repository.text}#${asked.issue} cannot be resumed directly`
    )
  }

  override async recover(asked: {
    agent: string,
    issue: number,
    repository: RepositoryName,
  }): Promise<void> {
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
        `conversation ${JSON.stringify(asked.agent)} is not the recorded plan for ${asked.repository.text}#${asked.issue}`
      )
    }
    const recovery = await this.calls.recoveryFor(watch)
    switch (recovery.action) {
      case 'cleanup':
      case 'inspect':
        throw new PlanRecoveryConflict(recovery.detail)
      case 'continue': {
        const call = recovery.call()
        this.#supervise(
          watch,
          call,
          this.continuation.execute(new ContinuePlanParams({ watch, call })),
        )
        return
      }
      case 'observe': {
        const call = recovery.call()
        const work = recovery.purposeOf(call) === 'plan'
          ? this.continuation.execute(new ContinuePlanParams({ watch, call }))
          : this.#waitForSuccess(call)
        this.#supervise(watch, call, work)
        return
      }
    }
  }

  override async fix(asked: {
    agent: string,
    issue: number,
    repository: RepositoryName,
    changes: string,
    requestId?: string,
  }): Promise<void> {
    const watch = await this.records.find({ issue: asked.issue, repository: asked.repository })
    if (watch === null || watch.agent !== asked.agent) {
      throw new PlanAgentNotResumed(
        `conversation ${JSON.stringify(asked.agent)} is not the recorded plan for `
        + `${asked.repository.text}#${asked.issue}`
      )
    }
    const requestId = asked.requestId ?? this.newId()
    const call = await this.calls.start(watch, 'fix', asked.changes, requestId)
    this.#supervise(watch, call, this.#waitForSuccess(call))
  }

  async #waitForSuccess(call: StartedPlanCall): Promise<void> {
    const completed = await this.calls.wait(call)
    HeadlessPlanAgents.#requireSuccess(completed)
  }

  #supervise(watch: PlanWatch, call: StartedPlanCall, work: Promise<void>): void {
    void work.catch((cause: unknown) => {
      this.stderr(
        `headless plan agent: ${watch.repository.text}#${watch.issue.number} conversation ${watch.agent} `
        + `call ${call.id} failed: ${cause instanceof Error ? cause.message : String(cause)}\n`
      )
    })
  }

  static #requireSuccess(completed: CompletedPlanCall): void {
    if (completed.succeeded) return
    if (completed.execution.kind === 'success') {
      throw new PlanAgentNotResumed(`call ${completed.call.id} did not exit successfully`)
    }
    throw new PlanAgentNotResumed(completed.execution.diagnostic)
  }
}
