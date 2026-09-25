import {
  SessionFailure,
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

const isSessionFailure = (value: unknown): value is SessionFailure =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

const carriesData = (event: Event): event is MessageEvent<string> => 'data' in event

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

const chained = <T>(id: string, action: () => Promise<T>): Promise<T> => {
  const previous = writeChains.get(id) ?? Promise.resolve()
  const outcome = previous.then(action)
  writeChains.set(id, outcome)
  void outcome.finally(() => {
    if (writeChains.get(id) === outcome) writeChains.delete(id)
  })
  return outcome
}

const type = (id: string, text: string): Promise<TypeOutcome> => chained(id, () => send(id, text))

const sendResize = async (id: string, size: TerminalSize): Promise<void> => {
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

const resize = (id: string, size: TerminalSize): Promise<void> => chained(id, () => sendResize(id, size))

export const SessionsClient = {
  watch,
  type,
  resize,
}
