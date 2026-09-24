import type { PreparationTarget } from './worktree-environments.ts'
import type { RepositoryPreparation } from '../value-objects/repository-preparation.ts'

export class PreparationReports {
  async announce(_asked: PreparationTarget & { preparation: RepositoryPreparation, path?: string }): Promise<void> {
    throw new Error('must implement announce()')
  }

  current(_asked: PreparationTarget): readonly RepositoryPreparation[] {
    throw new Error('must implement current()')
  }
}
