import {
  FreezeAskOutcome,
  FreezeFinding,
  PullRequestRef,
  SpecFreezeOutcome,
} from 'app/spec-freeze/SpecFreeze.types'
import { productError } from 'app/product-error'

const PATH = '/spec-freeze'
const GATE_KEY_HEADER = 'x-gate-key'
const TARGET_HEADER = 'x-coordinating-target'
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
  if (body.status === 'no-spec' && typeof body.target === 'string') return { kind: 'no-spec', target: body.target }
  if (
    body.status === 'draft' && typeof body.target === 'string' &&
    typeof body.spec === 'string' && isFreezeFindings(body.findings)
  ) {
    return {
      kind: 'draft',
      target: body.target,
      spec: body.spec,
      findings: body.findings,
      key: typeof body.key === 'string' ? body.key : null,
    }
  }
  if (
    body.status === 'frozen' &&
    typeof body.target === 'string' &&
    typeof body.spec === 'string' &&
    (body.on === null || typeof body.on === 'string') &&
    isNullablePullRequestRef(body.pullRequest)
  ) {
    return { kind: 'frozen', target: body.target, spec: body.spec, on: body.on, pullRequest: body.pullRequest }
  }
  return { kind: 'unavailable' }
}

const asRefusal = (body: unknown): SpecFreezeOutcome =>
  isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string'
    ? { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
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

const freeze = async (key: string, target: string): Promise<FreezeAskOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST', headers: { [GATE_KEY_HEADER]: key, [TARGET_HEADER]: target },
    })
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
  return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
}

export const SpecFreezeClient = {
  read,
  freeze,
}
