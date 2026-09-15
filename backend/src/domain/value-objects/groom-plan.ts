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
  static readonly #FIELD_SEPARATOR = ''
  static readonly #LABEL_SEPARATOR = ''
  static readonly #ISSUE_SEPARATOR = ''

  readonly milestone: string
  readonly issues: readonly GroomPlanIssue[]

  constructor({ milestone, issues }: { milestone: string, issues: GroomPlanIssue[] }) {
    this.milestone = milestone
    this.issues = Object.freeze([...issues])
    Object.freeze(this)
  }

  canonicalText(): string {
    return [this.milestone, ...this.issues.map((issue) => GroomPlan.#canonicalIssueText(issue))]
      .join(GroomPlan.#ISSUE_SEPARATOR)
  }

  static #canonicalIssueText(issue: GroomPlanIssue): string {
    return [String(issue.order), issue.title, issue.labels.join(GroomPlan.#LABEL_SEPARATOR)]
      .join(GroomPlan.#FIELD_SEPARATOR)
  }
}
