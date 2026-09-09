import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { PlanIssue } from '../value-objects/plan-issue.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { SownWorkspace } from '../value-objects/sown-workspace.ts'
import type { WorkspaceLocation } from '../value-objects/workspace-location.ts'
import type { WorkspaceSurvey } from '../value-objects/workspace-survey.ts'

export class Workspace {
  async confirm({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<CheckoutRoot> {
    throw new Error(
      `${this.constructor.name} must implement confirm({ root, repository }) and answer the canonical checkout root, asked whether ${root} holds ${repository}`
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

  async undo(located: WorkspaceLocation): Promise<void> {
    throw new Error(`${this.constructor.name} must implement undo(located), asked for ${located?.path}`)
  }
}
