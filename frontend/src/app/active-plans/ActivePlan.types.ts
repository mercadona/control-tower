import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'

type ActivePlanIdentity = {
  request: StartPlanRequest
  plan: StartedPlan
}

export type RecoveryAction = 'observe' | 'continue' | 'cleanup' | 'inspect'

export type PlanRefusal = {
  state: string
  outcome: string
  exit: number
  task: number | null
  findings: string | null
  verdict: string | null
}

export type ActivePlan = ActivePlanIdentity & (
  | { phase: 'planning' | 'implementing' }
  | {
      phase: 'uncertain'
      diagnostic: string
      recovery: { action: RecoveryAction; detail: string }
      refusal?: PlanRefusal
    }
)

export type RecoveryOutcome =
  | { kind: 'accepted'; agent: string }
  | { kind: 'refused'; code: string; detail: string }
  | { kind: 'unavailable' }

export type ActivePlansOutcome =
  | { kind: 'loaded'; plans: ActivePlan[] }
  | { kind: 'unavailable' }
  | { kind: 'inconclusive' }
