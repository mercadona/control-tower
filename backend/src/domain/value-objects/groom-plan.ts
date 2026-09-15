export class GroomPlanIssue {
  readonly order: number
  readonly title: string
  readonly labels: readonly string[]
  readonly repo: string

  constructor({ order, title, labels, repo }: { order: number, title: string, labels: string[], repo: string }) {
    this.order = order
    this.title = title
    this.labels = Object.freeze([...labels])
    this.repo = repo
    Object.freeze(this)
  }

  landsOutside(home: string): boolean {
    return this.repo.toLowerCase() !== home.toLowerCase()
  }
}

export class GroomPlan {
  static readonly #FIELD_SEPARATOR = ''
  static readonly #LABEL_SEPARATOR = ''
  static readonly #ISSUE_SEPARATOR = ''

  readonly milestone: string
  readonly home: string
  readonly issues: readonly GroomPlanIssue[]

  constructor({ milestone, home, issues }: { milestone: string, home: string, issues: GroomPlanIssue[] }) {
    this.milestone = milestone
    this.home = home
    this.issues = Object.freeze([...issues])
    Object.freeze(this)
  }

  canonicalText(): string {
    return [this.milestone, this.home, ...this.issues.map((issue) => GroomPlan.#canonicalIssueText(issue))]
      .join(GroomPlan.#ISSUE_SEPARATOR)
  }

  static #canonicalIssueText(issue: GroomPlanIssue): string {
    return [String(issue.order), issue.title, issue.labels.join(GroomPlan.#LABEL_SEPARATOR), issue.repo]
      .join(GroomPlan.#FIELD_SEPARATOR)
  }
}
