import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { RepositoryPreparation } from '../value-objects/repository-preparation.ts'

export type PreparationTarget = { root: CheckoutRoot, repository: RepositoryName }
export type PreparationWorkspace = PreparationTarget & { path: string }

export class RepositoryPreparations {
  async inspect(_asked: PreparationTarget): Promise<RepositoryPreparation> {
    throw new Error('must implement inspect()')
  }

  async prepare(_asked: PreparationWorkspace): Promise<RepositoryPreparation> {
    throw new Error('must implement prepare()')
  }
}
