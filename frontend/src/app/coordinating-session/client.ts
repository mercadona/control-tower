import {
  CoordinatingSessionOutcome, LiveSessionRef, OpenedCoordinatingSession, OpenOutcome, TimelineEvent, TimelineEventKind,
} from 'app/coordinating-session/CoordinatingSession.types'
import { StartPlanSubmission } from 'app/start-plan/StartPlan.types'

const TIMELINE_EVENT_KINDS: readonly TimelineEventKind[] = [
  'opened', 'resumed', 'unresumable', 'working', 'waiting-for-permission', 'completed', 'ended',
]

const PATH = '/coordinating-session'
const OPENED = 202

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

const bodyFor = ({ id, userComment, repo, path }: StartPlanSubmission): Record<string, string> => ({
  ...(id !== null ? { id } : {}),
  ...(userComment !== null ? { user_comment: userComment } : {}),
  repo,
  path,
})

const toOutcome = (body: unknown): CoordinatingSessionOutcome => {
  if (!isRecord(body)) return { kind: 'unavailable' }
  if (body.status === 'none') return { kind: 'none' }
  if (
    body.status === 'live' &&
    typeof body.conversation === 'string' &&
    typeof body.repo === 'string' &&
    typeof body.root === 'string' &&
    isLiveSessionRef(body.session) &&
    isAttention(body.attention) &&
    isTimeline(body.timeline)
  ) {
    return {
      kind: 'live',
      conversation: body.conversation,
      repo: body.repo,
      root: body.root,
      session: body.session,
      attention: body.attention,
      timeline: body.timeline,
    }
  }
  if (
    body.status === 'unresumable' &&
    typeof body.conversation === 'string' &&
    typeof body.detail === 'string' &&
    isTimeline(body.timeline)
  ) {
    return { kind: 'unresumable', conversation: body.conversation, detail: body.detail, timeline: body.timeline }
  }
  if (
    body.status === 'ended' &&
    typeof body.conversation === 'string' &&
    typeof body.detail === 'string' &&
    isTimeline(body.timeline)
  ) {
    return { kind: 'ended', conversation: body.conversation, detail: body.detail, timeline: body.timeline }
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
  isRecord(body) && typeof body.conversation === 'string' && isLiveSessionRef(body.session)
    ? { conversation: body.conversation, session: body.session }
    : null

const open = async (submission: StartPlanSubmission): Promise<OpenOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(submission)),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  const body: unknown = await response.json()
  if (response.status === OPENED) {
    const opened = openedIn(body)

    return opened === null ? { kind: 'backend-unreachable' } : { kind: 'opened', opened }
  }
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.detail !== 'string') {
    return { kind: 'backend-unreachable' }
  }
  return { kind: 'refused', code: body.code, error: body.detail }
}

export const CoordinatingSessionClient = {
  read,
  open,
  openedIn,
}
