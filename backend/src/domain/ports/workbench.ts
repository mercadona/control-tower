import type { RepositoryName } from '../value-objects/repository-name.ts'

export class Workbench {
  async reopen({ issueNumber, repository }: { issueNumber: number, repository: RepositoryName }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement reopen({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
