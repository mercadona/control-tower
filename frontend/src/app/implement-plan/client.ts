import {
  ImplementPlanOutcome,
  ImplementPlanRefusal,
  ImplementPlanRequest,
  ImplementPlanResult,
} from 'app/implement-plan/ImplementPlan.types'

const PATH = '/implement-plan'
const ACCEPTED = 202
const NO_LIVE_PLANNING_SESSION = 'no-live-planning-session'
const IMPLEMENTATION_PHASE_UNCERTAIN = 'implementation-phase-uncertain'
const PLAN_UNDER_REVIEW = 'plan-under-review'

const implement = async ({ agent, issue, repo }: ImplementPlanRequest): Promise<ImplementPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, issue, repo }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) {
    const implementing = (await response.json()) as ImplementPlanResult
    return { kind: 'implementing', agent: implementing.agent, issue: implementing.issue }
  }
  const refused = (await response.json()) as ImplementPlanRefusal
  if (refused.code === NO_LIVE_PLANNING_SESSION) return { kind: 'stale-agent', detail: refused.detail }
  if (refused.code === IMPLEMENTATION_PHASE_UNCERTAIN) return { kind: 'uncertain', detail: refused.detail }
  if (refused.code === PLAN_UNDER_REVIEW) return { kind: 'under-review' }
  return { kind: 'refused', detail: refused.detail }
}

export const ImplementPlanClient = {
  implement,
}
