import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'

type ActivePlanIdentity = {
  request: StartPlanRequest
  plan: StartedPlan
}

export type RecoveryAction = 'observe' | 'continue' | 'cleanup' | 'inspect'

export type ActivePlan = ActivePlanIdentity & (
  | { phase: 'planning' | 'implementing' }
  | { phase: 'uncertain'; diagnostic: string; recovery: { action: RecoveryAction; detail: string } }
)

export type RecoveryOutcome =
  | { kind: 'accepted'; agent: string }
  | { kind: 'refused'; code: string; detail: string }
  | { kind: 'unavailable' }

export type ActivePlansOutcome =
  | { kind: 'loaded'; plans: ActivePlan[] }
  | { kind: 'unavailable' }
  | { kind: 'inconclusive' }
