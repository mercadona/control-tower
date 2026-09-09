import {
  ReviewPlanOutcome,
  ReviewPlanRefusal,
  ReviewPlanRequest,
} from 'app/review-plan/ReviewPlan.types'

const PATH = '/review-plan'
const ACCEPTED = 202
const NO_LIVE_PLANNING_SESSION = 'no-live-planning-session'
const PLAN_ALREADY_BEING_IMPLEMENTED = 'plan-already-being-implemented'
const IMPLEMENTATION_PHASE_UNCERTAIN = 'implementation-phase-uncertain'

const askChanges = async ({ issue, repo, changes }: ReviewPlanRequest): Promise<ReviewPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue, repo, changes }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) return { kind: 'changes-asked' }
  const refused = (await response.json()) as ReviewPlanRefusal
  if (refused.code === NO_LIVE_PLANNING_SESSION) return { kind: 'stale-plan', detail: refused.detail }
  if (refused.code === PLAN_ALREADY_BEING_IMPLEMENTED) return { kind: 'plan-implementing', detail: refused.detail }
  if (refused.code === IMPLEMENTATION_PHASE_UNCERTAIN) return { kind: 'phase-uncertain', detail: refused.detail }
  return { kind: 'refused', detail: refused.detail }
}

export const ReviewPlanClient = {
  askChanges,
}
