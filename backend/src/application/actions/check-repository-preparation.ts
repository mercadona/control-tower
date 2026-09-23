import { RepositoryPreparationRequired } from '../../domain/exceptions.ts'
import type { WorktreeEnvironments, PreparationTarget, PreparationWorkspace } from '../../domain/ports/worktree-environments.ts'
import type { PreparationReports } from '../../domain/ports/preparation-reports.ts'
import type { RepositoryPreparation } from '../../domain/value-objects/repository-preparation.ts'

export class CheckRepositoryPreparation {
  readonly environments: WorktreeEnvironments
  readonly reports: PreparationReports

  constructor(ports: { environments: WorktreeEnvironments, reports: PreparationReports }) {
    this.environments = ports.environments
    this.reports = ports.reports
  }

  async execute(asked: PreparationTarget): Promise<RepositoryPreparation> {
    return this.#require(asked, await this.environments.inspect(asked))
  }

  async prepare(asked: PreparationWorkspace): Promise<RepositoryPreparation> {
    return this.#require(asked, await this.environments.prepare(asked))
  }

  async #require(asked: PreparationTarget, preparation: RepositoryPreparation): Promise<RepositoryPreparation> {
    await this.reports.announce({ ...asked, preparation })
    if (!preparation.permitsDispatch()) {
      throw new RepositoryPreparationRequired(preparation.summary)
    }
    return preparation
  }

  current(asked: PreparationTarget): readonly RepositoryPreparation[] {
    return this.reports.current(asked)
  }
}
