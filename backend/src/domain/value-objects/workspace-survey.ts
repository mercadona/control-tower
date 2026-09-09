import type { PreparedWorkspace } from './prepared-workspace.ts'
import type { RepositoryName } from './repository-name.ts'

export class WorkspaceSurvey {
  readonly repository: RepositoryName
  readonly prepared: readonly PreparedWorkspace[]

  constructor({ repository, prepared }: { repository: RepositoryName, prepared: readonly PreparedWorkspace[] }) {
    this.repository = repository
    this.prepared = Object.freeze([...prepared])
    Object.freeze(this)
  }
}
