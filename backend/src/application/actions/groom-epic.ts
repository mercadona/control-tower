import { ReadEpicGroom, ReadEpicGroomParams, EpicGroomState } from '../queries/read-epic-groom.ts'
import type { EpicGroomStateValue } from '../queries/read-epic-groom.ts'
import type { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import type { EpicGroom } from '../../domain/ports/epic-groom.ts'
import type { GroomPlan } from '../../domain/value-objects/groom-plan.ts'
import type { EpicIssue } from '../../domain/value-objects/epic-issue.ts'

export class GroomEpicParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName

  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }) {
    this.root = root
    this.repository = repository
    Object.freeze(this)
  }
}

export class EpicGroomed {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly issues: readonly EpicIssue[]

  constructor({ state, milestone, plan, issues }: {
    state: EpicGroomStateValue,
    milestone: string | null,
    plan: GroomPlan | null,
    issues: readonly EpicIssue[],
  }) {
    this.state = state
    this.milestone = milestone
    this.plan = plan
    this.issues = issues
    Object.freeze(this)
  }
}

export class GroomEpic {
  static readonly REFUSED: readonly EpicGroomStateValue[] = Object.freeze([
    EpicGroomState.NO_SPEC,
    EpicGroomState.DRAFT,
    EpicGroomState.AWAITING_PUBLICATION,
  ])

  readonly read: ReadEpicGroom
  readonly groom: EpicGroom

  constructor({ read, groom }: { read: ReadEpicGroom, groom: EpicGroom }) {
    this.read = read
    this.groom = groom
  }

  async execute(params: GroomEpicParams): Promise<EpicGroomed> {
    const before = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository }))

    if (GroomEpic.REFUSED.includes(before.state)) {
      return new EpicGroomed({ state: before.state, milestone: before.milestone, plan: before.plan, issues: before.issues })
    }

    await this.groom.run({
      root: params.root,
      spec: before.spec!,
      repository: params.repository,
      milestone: before.milestone!,
    })

    const after = await this.read.execute(new ReadEpicGroomParams({ root: params.root, repository: params.repository }))

    return new EpicGroomed({ state: after.state, milestone: after.milestone, plan: before.plan, issues: after.issues })
  }
}
