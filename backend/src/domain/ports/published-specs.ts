import type { RepositoryName } from '../value-objects/repository-name.ts'

export class PublishedSpecs {
  async holds({ repository, path }: { repository: RepositoryName, path: string }): Promise<boolean> {
    throw new Error(
      `${this.constructor.name} must implement holds({ repository, path }), asked about ${path} in ${repository}`
    )
  }
}
