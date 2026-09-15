import type { EpicSpec } from '../value-objects/epic-spec.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

export class PublishedSpecs {
  async holds({ repository, spec }: { repository: RepositoryName, spec: EpicSpec }): Promise<boolean> {
    throw new Error(
      `${this.constructor.name} must implement holds({ repository, spec }) and answer whether the default branch of `
      + `${repository} holds ${spec?.path} as this checkout holds it`
    )
  }
}
