import type { ActivePlan } from 'app/active-plans/ActivePlan.types'
import type { WorkflowSnapshot } from 'app/workflow-snapshot/storage'

type SlicePhase = ActivePlan['phase'] | WorkflowSnapshot['phase']

type SliceMessageOutcome =
  | { kind: 'delivered' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }

type SliceMessageAsked = { issue: number; repo: string; agent: string; text: string }

export type { SliceMessageAsked, SliceMessageOutcome, SlicePhase }
