import { ActivePlan, ActivePlansOutcome, RecoveryOutcome } from 'app/active-plans/ActivePlan.types'
import { isPlanForRequest, isRecord, isRequest } from 'app/workflow-snapshot/validation'
import { productError } from 'app/product-error'

const PATH = '/active-plans'
const RECOVERY_INCONCLUSIVE = 'active-plans-recovery-inconclusive'

const isRecovery = (value: unknown) =>
  isRecord(value) &&
  (value.action === 'observe' || value.action === 'continue' || value.action === 'cleanup' || value.action === 'inspect') &&
  typeof value.detail === 'string'

const isActivePlan = (value: unknown): value is ActivePlan => {
  if (!isRecord(value) || !isRequest(value.request) || !isPlanForRequest(value.plan, value.request)) return false
  if (value.phase === 'uncertain') return typeof value.diagnostic === 'string' && isRecovery(value.recovery)
  return (value.phase === 'planning' || value.phase === 'implementing')
    && !Object.hasOwn(value, 'diagnostic') && !Object.hasOwn(value, 'recovery')
}

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

const mutate = async (path: string, expectedStatus: number, plan: ActivePlan): Promise<RecoveryOutcome> => {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: plan.plan.repo, issue: plan.plan.issue.number, agent: plan.plan.agent }),
    })
  } catch {
    return { kind: 'unavailable' }
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === expectedStatus && isRecord(body)
    && Object.keys(body).length === 1 && body.agent === plan.plan.agent) {
    return { kind: 'accepted', agent: body.agent }
  }
  if (!response.ok && isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string') {
    return { kind: 'refused', code: body.code, detail: productError(body.code, body.detail) }
  }
  return { kind: 'unavailable' }
}

const recover = (plan: ActivePlan): Promise<RecoveryOutcome> => mutate('/recover-plan', 202, plan)
const cleanup = (plan: ActivePlan): Promise<RecoveryOutcome> => mutate('/cleanup-plan', 200, plan)

export const ActivePlansClient = { get, recover, cleanup }
