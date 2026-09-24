import { CoordinatingSessionClient } from 'app/coordinating-session/client'
import {
  EpicGroomAskOutcome,
  EpicGroomOutcome,
  EpicIssue,
  EpicPullRequest,
  GroomPlanIssue,
  GroomSessionOutcome,
  ReslicingOutcome,
} from 'app/epic-groom/EpicGroom.types'
import { productError } from 'app/product-error'

const PATH = '/epic-groom'
const PROMOTION_PATH = '/epic-promotion'
const SESSION_PATH = '/groom-session'
const RESLICING_PATH = '/spec-reslicing'
const GATE_KEY_HEADER = 'x-gate-key'
const PLAN_FINGERPRINT_HEADER = 'x-plan-fingerprint'
const TARGET_HEADER = 'x-coordinating-target'
const ACTED_STATUS = 200
const OPENED_STATUS = 202
const GROOMING_STATUS = 'grooming'
const TYPED_STATUS = 'typed'
const PUBLISHED_STATUS = 'published'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isGroomPlanIssue = (value: unknown): value is GroomPlanIssue =>
  isRecord(value) &&
  typeof value.order === 'number' &&
  typeof value.title === 'string' &&
  typeof value.repo === 'string' &&
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

type ActedRead = Extract<EpicGroomOutcome, { kind: 'groomed' } | { kind: 'authorised' }>

const readsAsActed = (outcome: EpicGroomOutcome): outcome is ActedRead => isActedStatus(outcome.kind)

const pullRequestAt = (body: Record<string, unknown>, field: string): EpicPullRequest | null => {
  const named = body[field]

  return isRecord(named) && typeof named.number === 'number' && typeof named.url === 'string'
    ? { number: named.number, url: named.url }
    : null
}

const pullRequestOf = (body: Record<string, unknown>): EpicPullRequest | null => pullRequestAt(body, 'pullRequest')

const keyOf = (body: Record<string, unknown>): string | null =>
  typeof body.key === 'string' ? body.key : null

const namesACheckout = (body: Record<string, unknown>): boolean =>
  typeof body.target === 'string' || body.target === null

const targetOf = (body: Record<string, unknown>): string | null =>
  typeof body.target === 'string' ? body.target : null

const promotedOf = (body: Record<string, unknown>): number[] =>
  Array.isArray(body.promoted) && body.promoted.every((issue) => typeof issue === 'number')
    ? body.promoted
    : []

const toOutcome = (body: unknown): EpicGroomOutcome => {
  if (!isRecord(body)) return { kind: 'unavailable' }
  if (body.status === 'none') return { kind: 'none' }
  if (!namesACheckout(body)) return { kind: 'unavailable' }
  const target = targetOf(body)
  if ('preparation' in body && (typeof body.preparation !== 'string' || body.preparation.length === 0)) return { kind: 'unavailable' }
  const preparation = typeof body.preparation === 'string' ? { preparation: body.preparation } : {}
  if (body.status === 'no-spec') return { kind: 'no-spec', target }
  if (body.status === 'draft') return { kind: 'draft', target }
  if (body.status === 'awaiting-publication') {
    return { kind: 'awaiting-publication', target, pullRequest: pullRequestOf(body) }
  }
  if (body.status === 'resliced') return { kind: 'resliced', target, key: keyOf(body) }
  if (body.status === 'issues-uncertain' && typeof body.milestone === 'string' && typeof body.reason === 'string') {
    return { kind: 'issues-uncertain', target, milestone: body.milestone, reason: body.reason }
  }
  if (
    body.status === 'groomable' &&
    typeof body.milestone === 'string' &&
    isRecord(body.plan) &&
    isGroomPlanIssues(body.plan.issues) &&
    typeof body.plan.home === 'string' &&
    typeof body.planFingerprint === 'string'
  ) {
    return {
      kind: 'groomable', target, milestone: body.milestone, plan: body.plan.issues, home: body.plan.home,
      planFingerprint: body.planFingerprint,
      reslicing: pullRequestAt(body, 'reslicing'),
      key: keyOf(body),
    }
  }
  if (
    body.status === 'partially-groomed' &&
    typeof body.milestone === 'string' &&
    isRecord(body.plan) &&
    isGroomPlanIssues(body.plan.issues) &&
    typeof body.plan.home === 'string' &&
    typeof body.planFingerprint === 'string' &&
    isEpicIssues(body.issues)
  ) {
    return {
      kind: 'partially-groomed', target, milestone: body.milestone, plan: body.plan.issues,
      planFingerprint: body.planFingerprint, issues: body.issues, key: keyOf(body),
    }
  }
  if (body.status === 'groomed' && typeof body.milestone === 'string' && isEpicIssues(body.issues)) {
    return { kind: 'groomed', target, milestone: body.milestone, issues: body.issues, key: keyOf(body), ...preparation }
  }
  if (body.status === 'authorised' && typeof body.milestone === 'string' && isEpicIssues(body.issues)) {
    return { kind: 'authorised', target, milestone: body.milestone, issues: body.issues, ...preparation,
      ...(preparation.preparation === undefined ? {} : { key: keyOf(body) }) }
  }
  return { kind: 'unavailable' }
}

const asRefusal = (body: unknown): EpicGroomOutcome =>
  isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string'
    ? { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
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

const confirmedByReading = async (target: string): Promise<EpicGroomAskOutcome> => {
  const outcome = await read()
  if (!readsAsActed(outcome) || outcome.target !== target) return { kind: 'unconfirmed' }

  return {
    kind: 'acted',
    status: outcome.kind,
    milestone: outcome.milestone,
    issues: outcome.issues,
    promoted: [],
  }
}

const press = async (path: string, target: string, headers: Record<string, string>): Promise<EpicGroomAskOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(path, { method: 'POST', headers: { ...headers, [TARGET_HEADER]: target } })
    body = await response.json()
  } catch {
    return await confirmedByReading(target)
  }
  if (response.status === ACTED_STATUS) {
    if (!isRecord(body) || !isActedStatus(body.status) || typeof body.milestone !== 'string' || !isEpicIssues(body.issues)) {
      return await confirmedByReading(target)
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
    return await confirmedByReading(target)
  }
  return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
}

const groom = (key: string, planFingerprint: string, target: string): Promise<EpicGroomAskOutcome> =>
  press(PATH, target, { [GATE_KEY_HEADER]: key, [PLAN_FINGERPRINT_HEADER]: planFingerprint })

const promote = (key: string, target: string): Promise<EpicGroomAskOutcome> =>
  press(PROMOTION_PATH, target, { [GATE_KEY_HEADER]: key })

const publishReslicing = async (key: string, target: string): Promise<ReslicingOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(RESLICING_PATH, {
      method: 'POST', headers: { [GATE_KEY_HEADER]: key, [TARGET_HEADER]: target },
    })
    body = await response.json()
  } catch {
    return { kind: 'unconfirmed' }
  }
  if (response.status === ACTED_STATUS) {
    if (!isRecord(body) || body.status !== PUBLISHED_STATUS) return { kind: 'unconfirmed' }
    const pullRequest = pullRequestOf(body)

    return pullRequest === null ? { kind: 'unconfirmed' } : { kind: 'published', pullRequest }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'unconfirmed' }
  }
  return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
}

const openSession = async (key: string, target: string): Promise<GroomSessionOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(SESSION_PATH, {
      method: 'POST', headers: { [GATE_KEY_HEADER]: key, [TARGET_HEADER]: target },
    })
    body = await response.json()
  } catch {
    return { kind: 'unconfirmed' }
  }
  if (response.status === OPENED_STATUS) {
    if (!isRecord(body)) return { kind: 'unconfirmed' }
    if (body.status === TYPED_STATUS) return { kind: 'typed' }
    if (body.status !== GROOMING_STATUS) return { kind: 'unconfirmed' }
    const opened = CoordinatingSessionClient.openedIn(body)

    return opened === null ? { kind: 'unconfirmed' } : { kind: 'opened', opened }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'unconfirmed' }
  }
  return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
}

export const EpicGroomClient = {
  read,
  groom,
  promote,
  openSession,
  publishReslicing,
}
