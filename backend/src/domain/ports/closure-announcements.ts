import type { RepositoryName } from '../value-objects/repository-name.ts'
import type { RunFailure } from '../value-objects/run-instruction.ts'

export type AnnouncedClosure = {
  repository: RepositoryName,
  issue: number,
  state: string,
  outcome: string,
  task: number | null,
  findings: string | null,
  verdict: string | null,
  vetoed: string | null,
  failure: RunFailure | null,
}

export class ClosureAnnouncements {
  async announce({ repository, issue, state }: AnnouncedClosure): Promise<boolean> {
    throw new Error(
      `${this.constructor.name} must implement announce({ repository, issue, state, outcome, task, `
      + `findings, verdict, vetoed, failure }), asked for ${repository.text}#${issue} at ${state}`
    )
  }
}
