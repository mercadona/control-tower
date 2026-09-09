import { PlanBriefing } from '../../domain/value-objects/plan-briefing.ts'
import { PlanWatch } from '../../domain/value-objects/plan-watch.ts'
import { PlanTarget } from '../../domain/value-objects/plan-target.ts'
import { PlanFailure } from '../../domain/exceptions.ts'
import type { BaselineResult } from '../../../../plugin/scripts/baseline.js'
import type { CheckoutRegistry } from '../../domain/ports/checkout-registry.ts'
import type { PlanAgents } from '../../domain/ports/plan-agents.ts'
import type { PlanComment } from '../../domain/value-objects/plan-comment.ts'
import type { PlanIssue } from '../../domain/value-objects/plan-issue.ts'
import type { PlanIssues } from '../../domain/ports/plan-issues.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { SownWorkspace } from '../../domain/value-objects/sown-workspace.ts'
import type { UserStories } from '../../domain/ports/user-stories.ts'
import type { UserStory } from '../../domain/value-objects/user-story.ts'
import type { UserStoryKey } from '../../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../../domain/value-objects/user-story-url.ts'
import type { Workspace } from '../../domain/ports/workspace.ts'
import type { WorkspaceLocation } from '../../domain/value-objects/workspace-location.ts'

export class StartPlanParams {
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly comment: PlanComment | null
  readonly targets: readonly PlanTarget[]

  constructor({ story, comment, targets }: {
    story: UserStoryKey | UserStoryUrl | null,
    comment: PlanComment | null,
    targets: readonly PlanTarget[],
  }) {
    this.story = story
    this.comment = comment
    this.targets = targets
    Object.freeze(this)
  }
}

export class PlanStarted {
  readonly agent: string
  readonly watch: PlanWatch
  readonly baseline: BaselineResult

  constructor({ agent, watch, baseline }: { agent: string, watch: PlanWatch, baseline: BaselineResult }) {
    this.agent = agent
    this.watch = watch
    this.baseline = baseline
    Object.freeze(this)
  }
}

export class PlanNotStarted {
  readonly repository: RepositoryName
  readonly cause: PlanFailure

  constructor({ repository, cause }: { repository: RepositoryName, cause: PlanFailure }) {
    this.repository = repository
    this.cause = cause
    Object.freeze(this)
  }
}

export class StartPlanResult {
  readonly started: readonly PlanStarted[]
  readonly failed: readonly PlanNotStarted[]

  constructor({ started, failed }: { started: readonly PlanStarted[], failed: readonly PlanNotStarted[] }) {
    this.started = started
    this.failed = failed
    Object.freeze(this)
  }
}

export class StartPlan {
  readonly userStories: UserStories
  readonly planIssues: PlanIssues
  readonly workspace: Workspace
  readonly planAgents: PlanAgents
  readonly checkouts: CheckoutRegistry

  constructor({ userStories, planIssues, workspace, planAgents, checkouts }: {
    userStories: UserStories,
    planIssues: PlanIssues,
    workspace: Workspace,
    planAgents: PlanAgents,
    checkouts: CheckoutRegistry,
  }) {
    this.userStories = userStories
    this.planIssues = planIssues
    this.workspace = workspace
    this.planAgents = planAgents
    this.checkouts = checkouts
  }

  async execute(params: StartPlanParams): Promise<StartPlanResult> {
    const confirmed: PlanTarget[] = []
    for (const target of params.targets) {
      const root = await this.workspace.confirm({ root: target.root, repository: target.repository })
      confirmed.push(new PlanTarget({ repository: target.repository, root }))
    }
    const detail = params.story === null ? null : await this.userStories.detail(params.story)

    const started: PlanStarted[] = []
    const failed: PlanNotStarted[] = []
    for (const target of confirmed) {
      try {
        started.push(await this.#start(target, params.story, params.comment, detail))
      } catch (failure) {
        if (!(failure instanceof PlanFailure)) throw failure
        failed.push(new PlanNotStarted({ repository: target.repository, cause: failure }))
      }
    }

    return new StartPlanResult({ started, failed })
  }

  async #start(
    target: PlanTarget,
    story: UserStoryKey | UserStoryUrl | null,
    comment: PlanComment | null,
    detail: UserStory | null
  ): Promise<PlanStarted> {
    const issue = await this.planIssues.open({ story: detail, comment, repository: target.repository })
    await this.planIssues.claim({ issue, repository: target.repository })
    const sown = await this.#prepare(target, issue)
    const located = sown.located
    const agent = await this.#launch(target, story, issue, located)
    this.checkouts.remember(target.root)

    return new PlanStarted({
      agent,
      baseline: sown.baseline,
      watch: new PlanWatch({ story, issue, located, repository: target.repository, agent }),
    })
  }

  async #prepare(target: PlanTarget, issue: PlanIssue): Promise<SownWorkspace> {
    try {
      return await this.workspace.prepare({ issue, repository: target.repository, root: target.root })
    } catch (failure) {
      await this.#release(target, issue)
      throw failure
    }
  }

  async #launch(
    target: PlanTarget,
    story: UserStoryKey | UserStoryUrl | null,
    issue: PlanIssue,
    located: WorkspaceLocation
  ): Promise<string> {
    try {
      return await this.planAgents.launch(new PlanBriefing({
        story,
        issue,
        located,
        repository: target.repository,
      }))
    } catch (failure) {
      await this.workspace.undo(located)
      await this.#release(target, issue)
      throw failure
    }
  }

  async #release(target: PlanTarget, issue: PlanIssue): Promise<void> {
    await this.planIssues.requeue({ issue, repository: target.repository })
  }
}
