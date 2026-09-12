export type ImplementPlanRequest = {
  agent: string
  issue: number
  repo: string
}

export type ImplementPlanResult = {
  status: 'implementing'
  agent: string
  issue: number
}

export type ImplementPlanRefusal = {
  code: string
  detail: string
}

export type ImplementPlanOutcome =
  | { kind: 'implementing'; agent: string; issue: number }
  | { kind: 'refused'; detail: string }
  | { kind: 'stale-agent'; detail: string }
  | { kind: 'uncertain'; detail: string }
  | { kind: 'backend-unreachable' }
