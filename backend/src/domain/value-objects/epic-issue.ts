import { PlanIssueStatus } from './plan-issue-status.ts'

export class EpicIssue {
  readonly number: number
  readonly url: string
  readonly title: string
  readonly status: string
  readonly isOpen: boolean
  readonly order: number | null

  constructor(
    issue: { number: number, url: string, title: string, status: string, isOpen: boolean, order: number | null }
  ) {
    if (!Number.isInteger(issue.number) || issue.number < 1) {
      throw new Error(`an epic issue is numbered from one, got ${JSON.stringify(issue.number)}`)
    }
    if (issue.url.length === 0) {
      throw new Error(`an epic issue is reachable at a url, got ${JSON.stringify(issue.url)}`)
    }
    if (issue.title.length === 0) {
      throw new Error(`an epic issue carries the title it was groomed with, got ${JSON.stringify(issue.title)}`)
    }
    if (issue.status.length === 0) {
      throw new Error(`an epic issue stands somewhere on the loop's ladder, got ${JSON.stringify(issue.status)}`)
    }
    this.number = issue.number
    this.url = issue.url
    this.title = issue.title
    this.status = issue.status
    this.isOpen = issue.isOpen
    this.order = issue.order
    Object.freeze(this)
  }

  isPromotable(): boolean {
    return this.isOpen && this.status === PlanIssueStatus.BACKLOG
  }
}
