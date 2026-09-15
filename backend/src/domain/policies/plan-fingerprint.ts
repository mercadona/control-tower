import type { GroomPlan } from '../value-objects/groom-plan.ts'

export class PlanFingerprint {
  readonly digest: (text: string) => string

  constructor({ digest }: { digest: (text: string) => string }) {
    this.digest = digest
    Object.freeze(this)
  }

  of(plan: GroomPlan): string {
    return this.digest(plan.canonicalText())
  }
}
