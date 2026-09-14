import type { CheckoutRoot } from '../value-objects/checkout-root.ts'
import type { EpicSpec } from '../value-objects/epic-spec.ts'
import type { GroomPlan } from '../value-objects/groom-plan.ts'
import type { RepositoryName } from '../value-objects/repository-name.ts'

type Grooming = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }

export class EpicGroom {
  async planned(asked: Grooming): Promise<GroomPlan> {
    throw new Error(`${this.constructor.name} must implement planned(asked), asked about ${asked?.milestone}`)
  }

  async run(asked: Grooming): Promise<void> {
    throw new Error(`${this.constructor.name} must implement run(asked), asked about ${asked?.milestone}`)
  }
}
