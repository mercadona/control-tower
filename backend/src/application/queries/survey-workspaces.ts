import type { Workspace } from '../../domain/ports/workspace.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { WorkspaceSurvey } from '../../domain/value-objects/workspace-survey.ts'

export class SurveyWorkspacesParams {
  readonly root: CheckoutRoot

  constructor({ root }: { root: CheckoutRoot }) {
    this.root = root
    Object.freeze(this)
  }
}

export class SurveyWorkspacesResult {
  readonly survey: WorkspaceSurvey

  constructor({ survey }: { survey: WorkspaceSurvey }) {
    this.survey = survey
    Object.freeze(this)
  }
}

export class SurveyWorkspaces {
  readonly workspace: Workspace

  constructor({ workspace }: { workspace: Workspace }) {
    this.workspace = workspace
  }

  async execute(params: SurveyWorkspacesParams): Promise<SurveyWorkspacesResult> {
    return new SurveyWorkspacesResult({ survey: await this.workspace.survey(params.root) })
  }
}
