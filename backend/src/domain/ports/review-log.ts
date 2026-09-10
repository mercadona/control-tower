import type { RepositoryName } from '../value-objects/repository-name.ts'

export class ReviewLog {
  noted({ issue, repository, at }: { issue: number, repository: RepositoryName, at: string }): void {
    throw new Error(
      `${this.constructor.name} must implement noted({ issue, repository, at }), told about ${issue} in ${repository} at ${at}`
    )
  }

  lastAskedAt({ issue, repository }: { issue: number, repository: RepositoryName }): string | null {
    throw new Error(
      `${this.constructor.name} must implement lastAskedAt({ issue, repository }), asked for ${issue} in ${repository}`
    )
  }
}
