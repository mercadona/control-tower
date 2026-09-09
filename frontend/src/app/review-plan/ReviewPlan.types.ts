export type ReviewPlanRequest = {
  issue: number
  repo: string
  changes: string
}

export type ReviewPlanResult = {
  status: 'changes-asked'
  issue: number
}

export type ReviewPlanRefusal = {
  code: string
  detail: string
}

export type ReviewPlanOutcome =
  | { kind: 'changes-asked'; issue: number }
  | { kind: 'stale-plan'; detail: string }
  | { kind: 'refused'; detail: string }
  | { kind: 'backend-unreachable' }
