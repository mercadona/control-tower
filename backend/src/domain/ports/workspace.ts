import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { SownWorkspace } from '../value-objects/sown-workspace.ts'
import type { RootedWorkspaceLocation } from '../value-objects/rooted-workspace-location.ts'
import type { WorkspaceSurvey } from '../value-objects/workspace-survey.ts'
import type { PlanWatch } from '../value-objects/plan-watch.ts'
import type { UnusedWorkspace } from '../value-objects/unused-workspace.ts'

export class Workspace {
  async inspectUnlaunched(watch: PlanWatch, previous: UnusedWorkspace | null): Promise<UnusedWorkspace> {
    throw new Error(
      `${this.constructor.name} must implement inspectUnlaunched(watch, previous), asked for ${watch.agent}`
    )
  }

  async undoUnlaunched(evidence: UnusedWorkspace): Promise<void> {
    throw new Error(`${this.constructor.name} must implement undoUnlaunched(evidence), asked for ${evidence.watch.agent}`)
  }

  async confirmAbsent(watch: PlanWatch): Promise<void> {
    throw new Error(`${this.constructor.name} must implement confirmAbsent(watch), asked for ${watch.agent}`)
  }

  async confirm({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<CheckoutRoot> {
    throw new Error(
      `${this.constructor.name} must implement confirm({ root, repository }) and answer the canonical checkout root, asked whether ${root} holds ${repository}`
    )
  }

  async confirmForSession({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<CheckoutRoot> {
    throw new Error(
      `${this.constructor.name} must implement confirmForSession({ root, repository }) and answer the canonical checkout root of a checkout that is on its default branch and up to date, asked whether ${root} holds ${repository}`
    )
  }

  async prepare({ issue, repository, root }: {
    issue: PlanIssue,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): Promise<SownWorkspace> {
    throw new Error(
      `${this.constructor.name} must implement prepare({ issue, repository, root }), asked for ${issue?.number} in ${repository} at ${root}`
    )
  }

  async survey(root: CheckoutRoot): Promise<WorkspaceSurvey> {
    throw new Error(`${this.constructor.name} must implement survey(root), asked about ${root}`)
  }

  async undo(located: RootedWorkspaceLocation): Promise<void> {
    throw new Error(`${this.constructor.name} must implement undo(located), asked for ${located?.path}`)
  }
}
