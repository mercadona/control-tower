import { PlanIssueStatus, type PlanIssueStatusValue } from '../value-objects/plan-issue-status.ts'

export type DeliveryStateValue = 'in-review' | 'fixing' | 'unattended'

export class DeliveryState {
  static readonly IN_REVIEW = 'in-review'
  static readonly FIXING = 'fixing'
  static readonly UNATTENDED = 'unattended'
}

export class DeliveryPolicy {
  static #BY_STATUS: ReadonlyMap<PlanIssueStatusValue, DeliveryStateValue> = new Map([
    [PlanIssueStatus.IN_REVIEW, DeliveryState.IN_REVIEW],
    [PlanIssueStatus.IN_PROGRESS, DeliveryState.FIXING],
    [PlanIssueStatus.READY, DeliveryState.UNATTENDED],
    [PlanIssueStatus.BACKLOG, DeliveryState.UNATTENDED],
    [PlanIssueStatus.NONE, DeliveryState.UNATTENDED],
  ])

  static of({ status }: { status: PlanIssueStatusValue }): DeliveryStateValue {
    const projected = DeliveryPolicy.#BY_STATUS.get(status)
    if (projected === undefined) {
      throw new Error(`no delivery state declared for the plan issue status ${JSON.stringify(status)}`)
    }

    return projected
  }
}
