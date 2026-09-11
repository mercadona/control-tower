export type InspectionLimits = Readonly<{
  budgetMs: number, commandBudgetMs: number, maxFiles: number, maxContainers: number,
}>

export class InspectionBudget {
  readonly startedAt: number
  readonly limits: InspectionLimits

  constructor(startedAt: number, limits: InspectionLimits) {
    for (const value of Object.values(limits)) {
      if (!Number.isInteger(value) || value <= 0) throw new Error('inspection limits must be positive integers')
    }
    this.startedAt = startedAt
    this.limits = Object.freeze({ ...limits })
    Object.freeze(this)
  }

  allowanceAt(now: number): number {
    return Math.max(0, Math.min(this.limits.commandBudgetMs, this.limits.budgetMs - (now - this.startedAt)))
  }
}
