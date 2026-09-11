import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { ImplementationHistory } from '../../domain/ports/implementation-history.ts'
import type { ImplementationHistoryEntry } from '../../domain/value-objects/implementation-history-entry.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class ReadImplementationHistoryParams {
  readonly root: CheckoutRoot
  readonly issue: number
  readonly repository: RepositoryName

  constructor({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository: RepositoryName,
  }) {
    this.root = root
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadImplementationHistoryResult {
  readonly entries: ImplementationHistoryEntry[]

  constructor({ entries }: { entries: ImplementationHistoryEntry[] }) {
    this.entries = entries
    Object.freeze(this)
  }
}

export class ReadImplementationHistory {
  readonly implementationHistory: ImplementationHistory

  constructor({ implementationHistory }: { implementationHistory: ImplementationHistory }) {
    this.implementationHistory = implementationHistory
  }

  async execute(params: ReadImplementationHistoryParams): Promise<ReadImplementationHistoryResult> {
    const entries = await this.implementationHistory.of({
      root: params.root,
      issue: params.issue,
      repository: params.repository,
    })

    return new ReadImplementationHistoryResult({ entries })
  }
}
