import type { HarvestOutcomeValue } from '../value-objects/harvest-outcome.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class Harvest {
  async collect({ issueNumber, repository, root }: {
    issueNumber: number,
    repository: RepositoryName,
    root: string | undefined,
  }): Promise<HarvestOutcomeValue> {
    throw new Error(
      `${this.constructor.name} must implement collect({ issueNumber, repository, root }), asked for ${issueNumber} in ${repository} at ${root}`
    )
  }
}
