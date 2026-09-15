import {
  EpicGroomAskOutcome,
  EpicGroomOutcome,
  EpicIssue,
  GroomPlanIssue,
} from 'app/epic-groom/EpicGroom.types'

const PATH = '/epic-groom'
const PROMOTION_PATH = '/epic-promotion'
const GATE_KEY_HEADER = 'x-gate-key'
const ACTED_STATUS = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isGroomPlanIssue = (value: unknown): value is GroomPlanIssue =>
  isRecord(value) &&
  typeof value.order === 'number' &&
  typeof value.title === 'string' &&
  Array.isArray(value.labels) &&
  value.labels.every((label) => typeof label === 'string')

const isGroomPlanIssues = (value: unknown): value is GroomPlanIssue[] =>
  Array.isArray(value) && value.every(isGroomPlanIssue)

const isEpicIssue = (value: unknown): value is EpicIssue =>
  isRecord(value) &&
  typeof value.number === 'number' &&
  typeof value.url === 'string' &&
  typeof value.title === 'string' &&
  typeof value.status === 'string'

const isEpicIssues = (value: unknown): value is EpicIssue[] =>
  Array.isArray(value) && value.every(isEpicIssue)

const isActedStatus = (value: unknown): value is 'groomed' | 'authorised' =>
  value === 'groomed' || value === 'authorised'

const keyOf = (body: Record<string, unknown>): string | null =>
  typeof body.key === 'string' ? body.key : null

const promotedOf = (body: Record<string, unknown>): number[] =>
  Array.isArray(body.promoted) && body.promoted.every((issue) => typeof issue === 'number')
    ? body.promoted
    : []

const toOutcome = (body: unknown): EpicGroomOutcome => {
  if (!isRecord(body)) return { kind: 'unavailable' }
  if (body.status === 'none') return { kind: 'none' }
  if (body.status === 'no-spec') return { kind: 'no-spec' }
  if (body.status === 'draft') return { kind: 'draft' }
  if (body.status === 'awaiting-publication') return { kind: 'awaiting-publication' }
  if (
    body.status === 'groomable' &&
    typeof body.milestone === 'string' &&
    isRecord(body.plan) &&
    isGroomPlanIssues(body.plan.issues)
  ) {
    return { kind: 'groomable', milestone: body.milestone, plan: body.plan.issues, key: keyOf(body) }
  }
  if (
    body.status === 'partially-groomed' &&
    typeof body.milestone === 'string' &&
    isRecord(body.plan) &&
    isGroomPlanIssues(body.plan.issues) &&
    isEpicIssues(body.issues)
  ) {
    return {
      kind: 'partially-groomed', milestone: body.milestone, plan: body.plan.issues, issues: body.issues,
      key: keyOf(body),
    }
  }
  if (body.status === 'groomed' && typeof body.milestone === 'string' && isEpicIssues(body.issues)) {
    return { kind: 'groomed', milestone: body.milestone, issues: body.issues, key: keyOf(body) }
  }
  if (body.status === 'authorised' && typeof body.milestone === 'string' && isEpicIssues(body.issues)) {
    return { kind: 'authorised', milestone: body.milestone, issues: body.issues }
  }
  return { kind: 'unavailable' }
}

const asRefusal = (body: unknown): EpicGroomOutcome =>
  isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string'
    ? { kind: 'refused', code: body.code, error: body.detail }
    : { kind: 'unavailable' }

const read = async (): Promise<EpicGroomOutcome> => {
  try {
    const response = await fetch(PATH)
    const body: unknown = await response.json()
    return response.ok ? toOutcome(body) : asRefusal(body)
  } catch {
    return { kind: 'unavailable' }
  }
}

const press = async (path: string, key: string): Promise<EpicGroomAskOutcome> => {
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', headers: { [GATE_KEY_HEADER]: key } })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  const body: unknown = await response.json()
  if (response.status === ACTED_STATUS) {
    if (!isRecord(body) || !isActedStatus(body.status) || typeof body.milestone !== 'string' || !isEpicIssues(body.issues)) {
      return { kind: 'backend-unreachable' }
    }
    return {
      kind: 'acted',
      status: body.status,
      milestone: body.milestone,
      issues: body.issues,
      promoted: promotedOf(body),
    }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'backend-unreachable' }
  }
  return { kind: 'refused', code: body.code, error: body.detail }
}

const groom = (key: string): Promise<EpicGroomAskOutcome> => press(PATH, key)

const promote = (key: string): Promise<EpicGroomAskOutcome> => press(PROMOTION_PATH, key)

export const EpicGroomClient = {
  read,
  groom,
  promote,
}
