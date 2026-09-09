export type StartPlanRequest = {
  id: string | null
  userComment?: string | null
  repo: string
  path: string
}

export type StartPlanSubmission = StartPlanRequest & {
  userComment: string | null
}

export type PlanIssue = {
  number: number
  url: string
}

export type BaselineOutcome = 'verde' | 'rojo' | 'no-verificado'

export type Baseline = {
  outcome: BaselineOutcome
  command: string | null
  summary: string
}

export type StartedPlan = {
  id: string | null
  repo: string
  issue: PlanIssue
  agent: string
  branch: string
  worktree: string
  root?: string
  baseline?: Baseline
}

export type StartPlanResult = StartedPlan & {
  status: 'started'
}

export type StartPlanRefusal = {
  code: string
  detail: string
}

export type StartPlanOutcome =
  | { kind: 'started'; plan: StartedPlan }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
