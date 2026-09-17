import { PlanStarted } from './start-plan.ts'
import {
  PlanAgentNotLaunched, PlanIssueNotClaimed, WorkspaceNotCleaned,
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

  async execute(params: StartMilestonePlanParams): Promise<PlanStarted> {
    const root = await this.workspace.confirm({ root: params.root, repository: params.repository })
    const issue = await this.candidates.next({ repository: params.repository, milestone: params.milestone })
    const claimed = { issue, repository: params.repository, root }
    const existing = await this.records.find({ issue: issue.number, repository: params.repository })
    if (existing !== null) {
      throw new PlanAgentNotLaunched(
        `the plan for ${issue} in ${params.repository} is already recorded as conversation ${existing.agent}`
      )
    }
    await this.claims.claim(claimed)
    const sown = await this.#prepare(claimed)
    const agent = await this.#launch(claimed, sown)
    const watch = new PlanWatch({
      story: null,
      issue,
      located: sown.located,
      repository: params.repository,
      agent,
    })
    this.checkouts.remember(new RegisteredCheckout({ repository: params.repository, root }))
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
