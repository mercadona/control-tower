import type { TrackedWork } from '../value-objects/tracked-work.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export abstract class WorkInventory {
  abstract find(issue: number, repository: RepositoryName): Promise<TrackedWork>
}
