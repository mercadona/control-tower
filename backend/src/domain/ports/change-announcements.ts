import type { RepositoryName } from '../value-objects/repository-name.ts'

export class ChangeAnnouncements {
  async announce({ repository, issue, ticket }: {
    repository: RepositoryName,
    issue: number,
    ticket: string,
  }): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement announce({ repository, issue, ticket }), `
      + `asked for ${repository.text}#${issue} as ${ticket}`
    )
  }
}
