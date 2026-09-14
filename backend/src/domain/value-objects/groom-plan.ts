export class GroomPlanIssue {
  readonly order: number
  readonly title: string
  readonly labels: readonly string[]

  constructor({ order, title, labels }: { order: number, title: string, labels: string[] }) {
    this.order = order
    this.title = title
    this.labels = Object.freeze([...labels])
    Object.freeze(this)
  }
}

export class GroomPlan {
  readonly milestone: string
  readonly issues: readonly GroomPlanIssue[]

  constructor({ milestone, issues }: { milestone: string, issues: GroomPlanIssue[] }) {
    this.milestone = milestone
    this.issues = Object.freeze([...issues])
    Object.freeze(this)
  }
}
