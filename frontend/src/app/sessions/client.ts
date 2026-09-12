import {
  LiveSession,
  SessionFailure,
  SessionsOutcome,
  SessionStreamListener,
  SessionStreamSubscription,
} from 'app/sessions/Sessions.types'

const PATH = '/sessions'
const BYTES_EVENT = 'message'
const FAILURE_EVENT = 'error'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLiveSession = (value: unknown): value is LiveSession =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'

const carriesData = (event: Event): event is MessageEvent<string> => 'data' in event

const list = async (): Promise<SessionsOutcome> => {
  try {
    const response = await fetch(PATH)
    const body: unknown = response.ok ? await response.json() : null
    if (!isRecord(body) || !Array.isArray(body.sessions) || !body.sessions.every(isLiveSession)) {
      return { kind: 'unavailable' }
    }
    return { kind: 'loaded', sessions: body.sessions }
  } catch {
    return { kind: 'unavailable' }
  }
}

const watch = (id: string, listener: SessionStreamListener): SessionStreamSubscription => {
  const source = new EventSource(`${PATH}/${encodeURIComponent(id)}/stream`)
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    source.close()
  }

  source.addEventListener(BYTES_EVENT, (event: MessageEvent<string>) => {
    const { bytes } = JSON.parse(event.data) as { bytes: string }
    listener.onBytes(bytes)
  })

  source.addEventListener(FAILURE_EVENT, (event: Event) => {
    if (settled) return
    if (carriesData(event)) {
      const failure = JSON.parse(event.data) as SessionFailure
      listener.onFailure(failure)
      return
    }
    const refused = source.readyState === EventSource.CLOSED
    settle()
    if (refused) {
      listener.onRefused()
      return
    }
    listener.onUnreachable()
  })

  return { close: settle }
}

const type = async (id: string, text: string): Promise<void> => {
  await fetch(`${PATH}/${encodeURIComponent(id)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export const SessionsClient = {
  list,
  watch,
  type,
}
