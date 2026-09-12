import { PlanProgress } from '../domain/ports/plan-progress.ts'
import { PlanState } from '../domain/value-objects/plan-state.ts'
import { PlanProgressNotRead } from '../domain/exceptions.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { PlanStateValue } from '../domain/value-objects/plan-state.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { WorkspaceLocation } from '../domain/value-objects/workspace-location.ts'
import type { ToolRunner } from './tool-runner.ts'

export class PlanContractProgress extends PlanProgress {
  static readonly PLANS = 'docs/superpowers/plans'
  static readonly CONTRACT_UNMET = 6

  readonly node: ToolRunner['run']
  readonly git: ToolRunner['run']
  readonly dispatchCheck: string

  constructor({ node, git, dispatchCheck }: {
    node: ToolRunner['run'],
    git: ToolRunner['run'],
    dispatchCheck: string,
  }) {
    super()
    this.node = node
    this.git = git
    this.dispatchCheck = dispatchCheck
  }

  static contractArgvFor({ dispatchCheck, issue, repository }: {
    dispatchCheck: string,
    issue: PlanIssue,
    repository: RepositoryName,
  }): string[] {
    return [dispatchCheck, String(issue.number), '--repo', repository.text, '--check-plan']
  }

  static pendingArgvFor(located: WorkspaceLocation): string[] {
    return ['-C', located.path, 'status', '--porcelain', '--', PlanContractProgress.PLANS]
  }

  async of({ located, issue, repository }: {
    located: WorkspaceLocation,
    issue: PlanIssue,
    repository: RepositoryName,
  }): Promise<PlanStateValue> {
    const validated = await this.node(
      PlanContractProgress.contractArgvFor({ dispatchCheck: this.dispatchCheck, issue, repository }),
      { cwd: located.path }
    )
    if (validated.code === PlanContractProgress.CONTRACT_UNMET) return PlanState.WRITING
    if (validated.failed) {
      throw new PlanProgressNotRead(
        `dispatch-check --check-plan could not be asked in ${located.path}, it exited ${validated.code}: ${validated.stderr.trim()}`
      )
    }
    const pending = await this.git(PlanContractProgress.pendingArgvFor(located))
    if (pending.failed) {
      throw new PlanProgressNotRead(
        `git status could not say whether the plan of ${located.path} is committed: ${pending.stderr.trim()}`
      )
    }
    if (pending.stdout.trim().length > 0) return PlanState.WRITING

    return PlanState.READY
  }
}
