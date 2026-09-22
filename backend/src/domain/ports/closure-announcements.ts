import type { RepositoryName } from '../value-objects/repository-name.ts'

export type AnnouncedClosure = {
  repository: RepositoryName,
  issue: number,
  task: number | null,
  findings: string | null,
  verdict: string | null,
}

export class ClosureAnnouncements {
  async announce({ repository, issue, task }: AnnouncedClosure): Promise<void> {
    throw new Error(
      `${this.constructor.name} must implement announce({ repository, issue, task, findings, verdict }), `
      + `asked for ${repository.text}#${issue} task ${task}`
    )
  }
}
