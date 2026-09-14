import {
  FreezeAskOutcome,
  FreezeFinding,
  PullRequestRef,
  SpecFreezeOutcome,
} from 'app/spec-freeze/SpecFreeze.types'

const PATH = '/spec-freeze'
const GATE_KEY_HEADER = 'x-gate-key'
const FROZEN_STATUS = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPullRequestRef = (value: unknown): value is PullRequestRef =>
  isRecord(value) && typeof value.number === 'number' && typeof value.url === 'string'

const isNullablePullRequestRef = (value: unknown): value is PullRequestRef | null =>
  value === null || isPullRequestRef(value)

const isFreezeFinding = (value: unknown): value is FreezeFinding =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  (value.line === null || typeof value.line === 'number') &&
  (value.detail === null || typeof value.detail === 'string')

const isFreezeFindings = (value: unknown): value is FreezeFinding[] =>
  Array.isArray(value) && value.every(isFreezeFinding)

const toOutcome = (body: unknown): SpecFreezeOutcome => {
  if (!isRecord(body)) return { kind: 'unavailable' }
  if (body.status === 'none') return { kind: 'none' }
  if (body.status === 'no-spec') return { kind: 'no-spec' }
  if (body.status === 'draft' && typeof body.spec === 'string' && isFreezeFindings(body.findings)) {
    return {
      kind: 'draft',
      spec: body.spec,
      findings: body.findings,
      key: typeof body.key === 'string' ? body.key : null,
    }
  }
  if (
    body.status === 'frozen' &&
    typeof body.spec === 'string' &&
    typeof body.on === 'string' &&
    isNullablePullRequestRef(body.pullRequest)
  ) {
    return { kind: 'frozen', spec: body.spec, on: body.on, pullRequest: body.pullRequest }
  }
  return { kind: 'unavailable' }
}

const asRefusal = (body: unknown): SpecFreezeOutcome =>
  isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string'
    ? { kind: 'refused', code: body.code, error: body.detail }
    : { kind: 'unavailable' }

const read = async (): Promise<SpecFreezeOutcome> => {
  try {
    const response = await fetch(PATH)
    const body: unknown = await response.json()
    return response.ok ? toOutcome(body) : asRefusal(body)
  } catch {
    return { kind: 'unavailable' }
  }
}

const freeze = async (key: string): Promise<FreezeAskOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, { method: 'POST', headers: { [GATE_KEY_HEADER]: key } })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  const body: unknown = await response.json()
  if (response.status === FROZEN_STATUS) {
    if (!isRecord(body) || typeof body.on !== 'string' || !isPullRequestRef(body.pullRequest)) {
      return { kind: 'backend-unreachable' }
    }
    return { kind: 'frozen', on: body.on, pullRequest: body.pullRequest }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'backend-unreachable' }
  }
  return { kind: 'refused', code: body.code, error: body.detail }
}

export const SpecFreezeClient = {
  read,
  freeze,
}
