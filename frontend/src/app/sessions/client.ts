import {
  LiveSession,
  SessionFailure,
  SessionsOutcome,
  SessionStreamListener,
  SessionStreamSubscription,
  TerminalSize,
  TypeOutcome,
} from 'app/sessions/Sessions.types'

const PATH = '/sessions'
const OPENED_EVENT = 'open'
const BYTES_EVENT = 'message'
const FAILURE_EVENT = 'error'
const WRITE_TIMEOUT_MS = 2_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLiveSession = (value: unknown): value is LiveSession =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'

const isSessionFailure = (value: unknown): value is SessionFailure =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

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

  source.addEventListener(OPENED_EVENT, () => listener.onOpened())

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
    if (source.readyState !== EventSource.CLOSED) {
      listener.onUnreachable()
      return
    }
    settle()
    listener.onRefused()
  })

  return { close: settle }
}

const send = async (id: string, text: string): Promise<TypeOutcome> => {
  try {
    const response = await fetch(`${PATH}/${encodeURIComponent(id)}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
    if (response.ok) return { kind: 'typed' }
    const body: unknown = await response.json()
    if (!isSessionFailure(body)) return { kind: 'unreachable' }
    return { kind: 'refused', code: body.code, detail: body.detail }
  } catch {
    return { kind: 'unreachable' }
  }
}

const writeChains = new Map<string, Promise<unknown>>()

const type = (id: string, text: string): Promise<TypeOutcome> => {
  const previous = writeChains.get(id) ?? Promise.resolve()
  const outcome = previous.then(() => send(id, text))
  writeChains.set(id, outcome)
  void outcome.finally(() => {
    if (writeChains.get(id) === outcome) writeChains.delete(id)
  })
  return outcome
}

const resize = async (id: string, size: TerminalSize): Promise<void> => {
  try {
    await fetch(`${PATH}/${encodeURIComponent(id)}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(size),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
  } catch {
    return
  }
}

export const SessionsClient = {
  list,
  watch,
  type,
  resize,
}
