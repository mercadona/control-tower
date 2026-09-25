import { ActivePlan, ActivePlansOutcome, RecoveryOutcome } from 'app/active-plans/ActivePlan.types'
import { productError } from 'app/product-error'
import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'

const PATH = '/active-plans'
const RECOVERY_INCONCLUSIVE = 'active-plans-recovery-inconclusive'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const isTicketOrAbsent = (id: unknown): id is string | null =>
  id === null || (typeof id === 'string' && TicketKey.isWellFormed(id))

const isRequest = (value: unknown): value is StartPlanRequest =>
  isRecord(value) &&
  isTicketOrAbsent(value.id) &&
  typeof value.repo === 'string' &&
  RepositoryName.isWellFormed(value.repo) &&
  typeof value.path === 'string' &&
  LocalPath.isWellFormed(value.path)

const isWorktreeUnder = (worktree: string, path: string): boolean => {
  const normalizedWorktree = LocalPath.normalize(worktree)
  const normalizedPath = LocalPath.normalize(path)
  const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`

  return normalizedWorktree !== normalizedPath && normalizedWorktree.startsWith(prefix)
}

const isWellFormedRoot = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === 'string' && LocalPath.isWellFormed(value))

const isPlanForRequest = (value: unknown, request: StartPlanRequest): value is StartedPlan =>
  isRecord(value) &&
  isTicketOrAbsent(value.id) &&
  value.id === request.id &&
  typeof value.repo === 'string' &&
  RepositoryName.isWellFormed(value.repo) &&
  value.repo === request.repo &&
  isRecord(value.issue) &&
  typeof value.issue.number === 'number' &&
  Number.isInteger(value.issue.number) &&
  value.issue.number > 0 &&
  isNonEmptyString(value.issue.url) &&
  isNonEmptyString(value.agent) &&
  isNonEmptyString(value.branch) &&
  isNonEmptyString(value.worktree) &&
  LocalPath.isWellFormed(value.worktree) &&
  isWellFormedRoot(value.root) &&
  isWorktreeUnder(value.worktree, typeof value.root === 'string' ? value.root : request.path)

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
