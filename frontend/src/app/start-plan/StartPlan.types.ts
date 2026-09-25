export type StartPlanRequest = {
  id: string | null
  repo: string
  path: string
}

export type StartPlanSubmission = {
  id: string
  path: string
}

export type PlanIssue = {
  number: number
  url: string
}

export type StartedPlan = {
  id: string | null
  repo: string
  issue: PlanIssue
  agent: string
  branch: string
  worktree: string
  root?: string
}
