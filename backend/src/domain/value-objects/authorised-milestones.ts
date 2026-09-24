import { PlanIssueStatus } from './plan-issue-status.ts'

export class AuthorisedMilestones {
  readonly titles: readonly string[]

  private constructor(titles: readonly string[]) {
    this.titles = Object.freeze([...titles])
    Object.freeze(this)
  }

  static of(open: readonly { milestone: string | null, status: string }[]): AuthorisedMilestones {
    const titles = new Set(open.flatMap(
      (issue) => issue.status === PlanIssueStatus.READY && issue.milestone !== null ? [issue.milestone] : []
    ))

    return new AuthorisedMilestones([...titles].sort())
  }
}
