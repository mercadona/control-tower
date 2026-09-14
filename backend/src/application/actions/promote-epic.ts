import { ReadEpicGroom, ReadEpicGroomParams } from '../queries/read-epic-groom.ts'
import type { EpicGroomStateValue } from '../queries/read-epic-groom.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicIssues } from '../../domain/ports/epic-issues.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'

export class PromoteEpicParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export class EpicPromoted {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly issues: readonly EpicIssue[]
  readonly promoted: readonly number[]

  constructor({ state, milestone, issues, promoted }: {
    state: EpicGroomStateValue,
    milestone: string | null,
    issues: readonly EpicIssue[],
    promoted: readonly number[],
  }) {
    this.state = state
    this.milestone = milestone
    this.issues = issues
    this.promoted = promoted
    Object.freeze(this)
  }
}

export class PromoteEpic {
  readonly read: ReadEpicGroom
  readonly issues: EpicIssues

  constructor({ read, issues }: { read: ReadEpicGroom, issues: EpicIssues }) {
    this.read = read
    this.issues = issues
  }

  async execute(params: PromoteEpicParams): Promise<EpicPromoted> {
    const before = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository }))

    if (before.issues.length === 0) {
      return new EpicPromoted({ state: before.state, milestone: before.milestone, issues: before.issues, promoted: [] })
    }

    const waiting = before.issues.filter((issue) => issue.isPromotable())
    for (const issue of waiting) {
      await this.issues.promote({ repository: params.repository, issue })
    }

    const after = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository }))

    return new EpicPromoted({
      state: after.state,
      milestone: after.milestone,
      issues: after.issues,
      promoted: waiting.map((issue) => issue.number),
    })
  }
}
