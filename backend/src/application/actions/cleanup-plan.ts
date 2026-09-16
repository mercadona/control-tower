import {
  PlanCleanupConflict,
  PlanCleanupNotFound,
  PlanCleanupNotRead,
  PlanCleanupNotUnderstood,
  PlanIssueNotClaimed,
  PlanStatusNotRead,
  PlanStatusNotUnderstood,
} from '../../domain/exceptions.ts'
import type { DispatchClaims } from '../../domain/ports/dispatch-claims.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { PlanRecords } from '../../domain/ports/plan-records.ts'
import type { Workspace } from '../../domain/ports/workspace.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import { PlanIssueStatus, type PlanIssueStatusValue } from '../../domain/value-objects/plan-issue-status.ts'
import type { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class CleanupPlanParams {
  readonly agent: string
  readonly issue: number
  readonly repository: RepositoryName

  constructor(asked: { agent: string, issue: number, repository: RepositoryName }) {
    this.agent = asked.agent
    this.issue = asked.issue
    this.repository = asked.repository
    Object.freeze(this)
  }
}

export class CleanupPlan {
  readonly records: PlanRecords
  readonly workspace: Workspace
  readonly claims: DispatchClaims
  readonly planIssues: PlanIssues

  constructor(ports: {
    records: PlanRecords,
    workspace: Workspace,
    claims: DispatchClaims,
    planIssues: PlanIssues,
  }) {
    this.records = ports.records
    this.workspace = ports.workspace
    this.claims = ports.claims
    this.planIssues = ports.planIssues
  }

  async execute(params: CleanupPlanParams): Promise<void> {
    const retired = await this.records.retired(params.agent)
    if (retired !== null) {
      CleanupPlan.#requireIdentity(retired, params)
      return
    }
    const watch = await this.records.recorded(params.agent)
    if (watch === null) throw new PlanCleanupNotFound(`no active plan is recorded for ${params.agent}`)
    CleanupPlan.#requireIdentity(watch, params)
    if (await this.records.nonLaunch(watch) === null) {
      throw new PlanCleanupConflict(`conversation ${params.agent} has no definite initial non-launch proof`)
    }
    CleanupPlan.#requireCleanableStatus(await this.#status(watch))
    const previous = await this.records.cleanupEvidence(watch)
    const evidence = await this.workspace.inspectUnlaunched(watch, previous)
    if (previous === null) await this.records.recordCleanupEvidence(evidence)
    await this.workspace.undoUnlaunched(evidence)
    await this.workspace.confirmAbsent(watch)
    await this.#release(watch)
    await this.workspace.confirmAbsent(watch)
    await this.records.archive(watch)
  }

  async #release(watch: PlanWatch): Promise<void> {
    const status = await this.#status(watch)
    if (status === PlanIssueStatus.READY) return
    if (status !== PlanIssueStatus.IN_PROGRESS) {
      throw new PlanCleanupConflict(`issue ${watch.repository.text}#${watch.issue.number} is ${status}`)
    }
    try {
      await this.claims.requeue({
        issue: watch.issue,
        repository: watch.repository,
        root: new CheckoutRoot(watch.located.root),
      })
    } catch (cause) {
      if (!(cause instanceof PlanIssueNotClaimed)) throw cause
      let refreshed: PlanIssueStatusValue
      try {
        refreshed = await this.#status(watch)
      } catch (refreshCause) {
        const diagnostic = `checked requeue failed: ${cause.message}; status read failed: `
          + `${refreshCause instanceof Error ? refreshCause.message : String(refreshCause)}`
        if (refreshCause !== null && typeof refreshCause === 'object'
          && refreshCause.constructor === PlanStatusNotRead) throw new PlanCleanupNotRead(diagnostic)
        if (refreshCause !== null && typeof refreshCause === 'object'
          && refreshCause.constructor === PlanStatusNotUnderstood) throw new PlanCleanupNotUnderstood(diagnostic)
        throw refreshCause
      }
      if (refreshed === PlanIssueStatus.READY) return
      throw new PlanCleanupNotRead(cause instanceof Error ? cause.message : String(cause))
    }
    const refreshed = await this.#status(watch)
    if (refreshed !== PlanIssueStatus.READY) {
      throw new PlanCleanupConflict(
        `issue ${watch.repository.text}#${watch.issue.number} remained ${refreshed} after checked requeue`
      )
    }
  }

  async #status(watch: PlanWatch): Promise<PlanIssueStatusValue> {
    return this.planIssues.statusOf({ issueNumber: watch.issue.number, repository: watch.repository })
  }

  static #requireCleanableStatus(status: PlanIssueStatusValue): void {
    if (status === PlanIssueStatus.READY || status === PlanIssueStatus.IN_PROGRESS) return
    throw new PlanCleanupConflict(`cleanup requires ready or in-progress status, got ${status}`)
  }

  static #requireIdentity(watch: PlanWatch, params: CleanupPlanParams): void {
    if (watch.agent === params.agent && watch.issue.number === params.issue
      && watch.repository.text === params.repository.text) return
    throw new PlanCleanupConflict(
      `conversation ${JSON.stringify(params.agent)} does not name ${params.repository.text}#${params.issue}`
    )
  }
}
