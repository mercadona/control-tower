import { PlanStarted } from './start-plan.ts'
import {
  PlanAgentNotLaunched, PlanFailure, PlanIssueNotClaimed, WorkspaceNotCleaned,
} from '../../domain/exceptions.ts'
import { RegisteredCheckout } from '../../domain/value-objects/registered-checkout.ts'
import { PlanBriefing } from '../../domain/value-objects/plan-briefing.ts'
import { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import type { CheckoutRegistry } from '../../domain/ports/checkout-registry.ts'
import type { DispatchCandidates } from '../../domain/ports/dispatch-candidates.ts'
import type { DispatchClaims } from '../../domain/ports/dispatch-claims.ts'
import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { PlanRecords } from '../../domain/ports/plan-records.ts'
import type { Workspace } from '../../domain/ports/workspace.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { SownWorkspace } from '../../domain/value-objects/sown-workspace.ts'

type ClaimedIssue = { issue: PlanIssue, repository: RepositoryName, root: CheckoutRoot }

export class SliceNotStarted {
  readonly issue: PlanIssue
  readonly repository: RepositoryName
  readonly cause: PlanFailure

  constructor({ issue, repository, cause }: {
    issue: PlanIssue, repository: RepositoryName, cause: PlanFailure,
  }) {
    this.issue = issue
    this.repository = repository
    this.cause = cause
    Object.freeze(this)
  }
}

export class StartMilestonePlanResult {
  readonly started: readonly PlanStarted[]
  readonly failed: readonly SliceNotStarted[]

  constructor({ started, failed }: {
    started: readonly PlanStarted[], failed: readonly SliceNotStarted[],
  }) {
    this.started = started
    this.failed = failed
    Object.freeze(this)
  }
}

export class StartMilestonePlanParams {
  readonly repository: RepositoryName
  readonly root: CheckoutRoot
  readonly milestone: string

  constructor(asked: { repository: RepositoryName, root: CheckoutRoot, milestone: string }) {
    this.repository = asked.repository
    this.root = asked.root
    this.milestone = asked.milestone
    Object.freeze(this)
  }
}

export class StartMilestonePlan {
  readonly candidates: DispatchCandidates
  readonly claims: DispatchClaims
  readonly workspace: Workspace
  readonly agents: PlanAgents
  readonly records: PlanRecords
  readonly checkouts: CheckoutRegistry

  constructor(ports: {
    candidates: DispatchCandidates,
    claims: DispatchClaims,
    workspace: Workspace,
    agents: PlanAgents,
    records: PlanRecords,
    checkouts: CheckoutRegistry,
  }) {
    this.candidates = ports.candidates
    this.claims = ports.claims
    this.workspace = ports.workspace
    this.agents = ports.agents
    this.records = ports.records
    this.checkouts = ports.checkouts
  }

  async execute(params: StartMilestonePlanParams): Promise<StartMilestonePlanResult> {
    const root = await this.workspace.confirm({ root: params.root, repository: params.repository })
    const admissible = await this.candidates.admissible({
      repository: params.repository, milestone: params.milestone,
    })

    const started: PlanStarted[] = []
    const failed: SliceNotStarted[] = []
    for (const issue of admissible) {
      try {
        started.push(await this.#start({ issue, repository: params.repository, root }))
      } catch (failure) {
        if (!(failure instanceof PlanFailure)) throw failure
        failed.push(new SliceNotStarted({ issue, repository: params.repository, cause: failure }))
      }
    }

    return new StartMilestonePlanResult({ started, failed })
  }

  async #start(claimed: ClaimedIssue): Promise<PlanStarted> {
    const existing = await this.records.find({
      issue: claimed.issue.number, repository: claimed.repository,
    })
    if (existing !== null) {
      throw new PlanAgentNotLaunched(
        `the plan for ${claimed.issue} in ${claimed.repository} is already recorded as conversation ${existing.agent}`
      )
    }
    await this.claims.claim(claimed)
    const sown = await this.#prepare(claimed)
    const agent = await this.#launch(claimed, sown)
    const watch = new PlanWatch({
      story: null,
      issue: claimed.issue,
      located: sown.located,
      repository: claimed.repository,
      agent,
    })
    this.checkouts.remember(new RegisteredCheckout({ repository: claimed.repository, root: claimed.root }))

    return new PlanStarted({ agent, watch, baseline: sown.baseline })
  }

  async #prepare(claimed: ClaimedIssue): Promise<SownWorkspace> {
    try {
      return await this.workspace.prepare(claimed)
    } catch (failure) {
      if (failure instanceof WorkspaceNotCleaned) throw failure
      await this.#requeue(claimed, failure)
      throw failure
    }
  }

  async #launch(claimed: ClaimedIssue, sown: SownWorkspace): Promise<string> {
    try {
      return await this.agents.launch(new PlanBriefing({
        story: null,
        issue: claimed.issue,
        located: sown.located,
        repository: claimed.repository,
      }))
    } catch (failure) {
      if (!(await this.#launchWasUnrecorded(claimed))) throw failure
      try {
        await this.workspace.undo(sown.located)
      } catch (cleanup) {
        throw new WorkspaceNotCleaned(
          `workspace cleanup failed after ${StartMilestonePlan.#diagnostic(failure)}: ${StartMilestonePlan.#diagnostic(cleanup)}`
        )
      }
      await this.#requeue(claimed, failure)
      throw failure
    }
  }

  async #launchWasUnrecorded(claimed: ClaimedIssue): Promise<boolean> {
    try {
      return await this.records.find({
        issue: claimed.issue.number, repository: claimed.repository,
      }) === null
    } catch {
      return false
    }
  }

  async #requeue(claimed: ClaimedIssue, original: unknown): Promise<void> {
    try {
      await this.claims.requeue(claimed)
    } catch (compensation) {
      throw new PlanIssueNotClaimed(
        `claim compensation failed after ${StartMilestonePlan.#diagnostic(original)}: ${StartMilestonePlan.#diagnostic(compensation)}`
      )
    }
  }

  static #diagnostic(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
