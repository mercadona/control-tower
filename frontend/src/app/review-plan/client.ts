import {
  ReviewPlanOutcome,
  ReviewPlanRefusal,
  ReviewPlanRequest,
  ReviewPlanResult,
} from 'app/review-plan/ReviewPlan.types'

const PATH = '/review-plan'
const ACCEPTED = 202
const NO_LIVE_PLANNING_SESSION = 'no-live-planning-session'

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
  if (response.status === ACCEPTED) {
    const asked = (await response.json()) as ReviewPlanResult
    return { kind: 'changes-asked', issue: asked.issue }
  }
  const refused = (await response.json()) as ReviewPlanRefusal
  if (refused.code === NO_LIVE_PLANNING_SESSION) return { kind: 'stale-plan', detail: refused.detail }
  return { kind: 'refused', detail: refused.detail }
}

export const ReviewPlanClient = {
  askChanges,
}
