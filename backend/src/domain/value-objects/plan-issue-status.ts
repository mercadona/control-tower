export type PlanIssueStatusValue = 'backlog' | 'ready' | 'in-progress' | 'in-review' | 'none'

export class PlanIssueStatus {
  static readonly BACKLOG = 'backlog'
  static readonly READY = 'ready'
  static readonly IN_PROGRESS = 'in-progress'
  static readonly IN_REVIEW = 'in-review'
  static readonly NONE = 'none'
}
