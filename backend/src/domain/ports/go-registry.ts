import type { RepositoryName } from '../value-objects/repository-name.ts'

export class GoRegistry {
  async mint({ issueNumber, repository }: { issueNumber: number, repository: RepositoryName }): Promise<string> {
    throw new Error(
      `${this.constructor.name} must implement mint({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
