import { ActivePlan, ActivePlansOutcome } from 'app/active-plans/ActivePlan.types'
import { isPlanForRequest, isRecord, isRequest } from 'app/workflow-snapshot/validation'

const PATH = '/active-plans'
const RECOVERY_INCONCLUSIVE = 'active-plans-recovery-inconclusive'

const isActivePlan = (value: unknown): value is ActivePlan =>
  isRecord(value) &&
  (value.phase === 'planning' || value.phase === 'implementing' || value.phase === 'uncertain') &&
  isRequest(value.request) &&
  isPlanForRequest(value.plan, value.request)

const get = async (): Promise<ActivePlansOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH)
  } catch {
    return { kind: 'unavailable' }
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    if (isRecord(body) && body.code === RECOVERY_INCONCLUSIVE) return { kind: 'inconclusive' }
    return { kind: 'unavailable' }
  }

  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body) || !Array.isArray(body.plans) || !body.plans.every(isActivePlan)) {
    return { kind: 'unavailable' }
  }

  return { kind: 'loaded', plans: body.plans }
}

export const ActivePlansClient = { get }
