import {
  CloseOutcome, ClosureError, CoordinatingOperation, CoordinatingSessionOutcome, LiveSessionRef,
  OpenedCoordinatingSession, OpenOutcome, TimelineEvent, TimelineEventKind,
} from 'app/coordinating-session/CoordinatingSession.types'
import { StartPlanSubmission } from 'app/start-plan/StartPlan.types'
import { productError } from 'app/product-error'

const TIMELINE_EVENT_KINDS: readonly TimelineEventKind[] = [
  'opened', 'resumed', 'unresumable', 'working', 'waiting-for-permission', 'completed', 'ended',
]

const PATH = '/coordinating-session'
const OPENED = 202
const CLOSED = 200
const OPERATIONS: readonly CoordinatingOperation[] = ['idle', 'recovering', 'opening', 'closing', 'close-failed']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLiveSessionRef = (value: unknown): value is LiveSessionRef =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'

const isAttentionStatus = (value: unknown): value is 'working' | 'waiting' => value === 'working' || value === 'waiting'

const isAttention = (value: unknown): value is { status: 'working' | 'waiting'; question: string | null } =>
  isRecord(value) &&
  isAttentionStatus(value.status) &&
  (value.question === null || typeof value.question === 'string')

const isTimelineEventKind = (value: unknown): value is TimelineEventKind =>
  typeof value === 'string' && TIMELINE_EVENT_KINDS.includes(value as TimelineEventKind)

const isTimelineEvent = (value: unknown): value is TimelineEvent =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isTimelineEventKind(value.kind) &&
  typeof value.at === 'string' &&
  (value.detail === null || typeof value.detail === 'string')

const isTimeline = (value: unknown): value is TimelineEvent[] => Array.isArray(value) && value.every(isTimelineEvent)

const isOperation = (value: unknown): value is CoordinatingOperation =>
  typeof value === 'string' && OPERATIONS.includes(value as CoordinatingOperation)

const closureErrorIn = (body: Record<string, unknown>): ClosureError | null =>
  isRecord(body.closureError) && typeof body.closureError.code === 'string' && typeof body.closureError.detail === 'string'
    ? { code: body.closureError.code, detail: body.closureError.detail }
    : null

const bodyFor = ({ id, path }: StartPlanSubmission): Record<string, string> => ({
  id,
  path,
})

const toOutcome = (body: unknown): CoordinatingSessionOutcome => {
  if (!isRecord(body)) return { kind: 'unavailable' }
  if (body.status === 'none' && isOperation(body.operation)) return { kind: 'none', operation: body.operation }
  if (
    body.status === 'live' &&
    isOperation(body.operation) &&
    typeof body.target === 'string' &&
    typeof body.conversation === 'string' &&
    typeof body.repo === 'string' &&
    typeof body.root === 'string' &&
    typeof body.repo === 'string' &&
    typeof body.root === 'string' &&
    isLiveSessionRef(body.session) &&
    isAttention(body.attention) &&
    isTimeline(body.timeline)
  ) {
    return {
      kind: 'live',
      operation: body.operation,
      target: body.target,
      conversation: body.conversation,
      repo: body.repo,
      root: body.root,
      session: body.session,
      attention: body.attention,
      timeline: body.timeline,
      closureError: closureErrorIn(body),
    }
  }
  if (
    body.status === 'unresumable' &&
    isOperation(body.operation) &&
    typeof body.target === 'string' &&
    typeof body.conversation === 'string' &&
    typeof body.repo === 'string' &&
    typeof body.root === 'string' &&
    typeof body.detail === 'string' &&
    isTimeline(body.timeline)
  ) {
    return {
      kind: 'unresumable', operation: body.operation, target: body.target, conversation: body.conversation,
      repo: body.repo, root: body.root,
      detail: body.detail, timeline: body.timeline, closureError: closureErrorIn(body),
    }
  }
  if (
    body.status === 'ended' &&
    isOperation(body.operation) &&
    typeof body.target === 'string' &&
    typeof body.conversation === 'string' &&
    typeof body.repo === 'string' &&
    typeof body.root === 'string' &&
    typeof body.detail === 'string' &&
    isTimeline(body.timeline)
  ) {
    return {
      kind: 'ended', operation: body.operation, target: body.target, conversation: body.conversation,
      repo: body.repo, root: body.root,
      detail: body.detail, timeline: body.timeline, closureError: closureErrorIn(body),
    }
  }
  return { kind: 'unavailable' }
}

const read = async (): Promise<CoordinatingSessionOutcome> => {
  try {
    const response = await fetch(PATH)
    if (!response.ok) return { kind: 'unavailable' }
    return toOutcome(await response.json())
  } catch {
    return { kind: 'unavailable' }
  }
}

const openedIn = (body: unknown): OpenedCoordinatingSession | null =>
  isRecord(body) && typeof body.target === 'string' && typeof body.conversation === 'string' &&
    typeof body.repo === 'string' && typeof body.root === 'string' && isLiveSessionRef(body.session)
    ? { target: body.target, conversation: body.conversation, repo: body.repo, root: body.root, session: body.session }
    : null

const open = async (submission: StartPlanSubmission): Promise<OpenOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(submission)),
    })
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === OPENED) {
    const opened = openedIn(body)

    return opened === null ? { kind: 'backend-unreachable' } : { kind: 'opened', opened }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'backend-unreachable' }
  }
  return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
}

const close = async (conversation: string, target: string): Promise<CloseOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(`${PATH}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation, target }),
    })
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (
    response.status === CLOSED && isRecord(body) && body.status === 'closed' &&
    body.conversation === conversation && body.target === target
  ) return { kind: 'closed', conversation, target }
  if (isRecord(body) && typeof body.code === 'string' && typeof body.detail === 'string') {
    return { kind: 'refused', code: body.code, error: productError(body.code, body.detail) }
  }
  return { kind: 'backend-unreachable' }
}

export const CoordinatingSessionClient = {
  read,
  open,
  close,
  openedIn,
}
