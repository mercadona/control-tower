import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionsClient } from 'app/sessions/client'

const answering = (body: string) => vi.fn(async () => new Response(body))

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const idleListener = () => ({
  onOpened: () => undefined,
  onBytes: () => undefined,
  onFailure: () => undefined,
  onRefused: () => undefined,
  onUnreachable: () => undefined,
})

describe('SessionsClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the live sessions the backend lists reach the page', async () => {
    vi.stubGlobal('fetch', answering(SessionsMother.oneSession().body))

    await expect(SessionsClient.list()).resolves.toEqual({
      kind: 'loaded',
      sessions: [{ id: 'a1', name: 'zsh' }],
    })
  })

  it('a malformed session row makes the whole answer unavailable', async () => {
    vi.stubGlobal('fetch', answering(SessionsMother.malformedRow().body))

    await expect(SessionsClient.list()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('an unreachable backend is unavailable and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(SessionsClient.list()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('the bytes of a frame reach the listener', () => {
    FakeEventSource.install()
    const received: string[] = []

    SessionsClient.watch('a1', {
      ...idleListener(),
      onBytes: (bytes) => received.push(bytes),
    })
    FakeEventSource.last().receive('{"bytes":"hello"}')

    expect(received).toEqual(['hello'])
  })

  it('a connection the browser closed for good is a refusal', () => {
    FakeEventSource.install()
    let refusals = 0
    let unreachables = 0

    SessionsClient.watch('a1', {
      ...idleListener(),
      onRefused: () => (refusals += 1),
      onUnreachable: () => (unreachables += 1),
    })
    FakeEventSource.last().refuseBeforeOpen()

    expect(refusals).toBe(1)
    expect(unreachables).toBe(0)
  })

  it('a connection the browser is still retrying is not closed', () => {
    FakeEventSource.install()
    let unreachables = 0

    SessionsClient.watch('a1', {
      ...idleListener(),
      onUnreachable: () => (unreachables += 1),
    })
    FakeEventSource.last().dropConnection()

    expect(FakeEventSource.last().closes).toBe(0)
    expect(unreachables).toBe(1)
  })

  it('each connection announces itself before its first frame', () => {
    FakeEventSource.install()
    const events: string[] = []

    SessionsClient.watch('a1', {
      ...idleListener(),
      onOpened: () => events.push('opened'),
      onBytes: () => events.push('bytes'),
    })
    FakeEventSource.last().open()
    FakeEventSource.last().receive('{"bytes":"hello"}')

    expect(events).toEqual(['opened', 'bytes'])
  })

  it('typing posts the text as json to that session input', async () => {
    const posting = vi.fn(async () => new Response(JSON.stringify({ status: 'typed', id: 'a1' }), { status: 202 }))
    vi.stubGlobal('fetch', posting)

    await expect(SessionsClient.type('a1', 'ls -la')).resolves.toEqual({ kind: 'typed' })

    expect(posting).toHaveBeenCalledWith('/sessions/a1/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ls -la' }),
    })
  })

  it('a refused write is answered as refused, with the code the backend gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'session-not-live', detail: 'the shell has already exited' }),
      { status: 400 },
    )))

    await expect(SessionsClient.type('a1', 'ls')).resolves.toEqual({
      kind: 'refused',
      code: 'session-not-live',
      detail: 'the shell has already exited',
    })
  })

  it('a write that cannot reach the backend is answered as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(SessionsClient.type('a1', 'ls')).resolves.toEqual({ kind: 'unreachable' })
  })

  it('a write never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })))

    await expect(SessionsClient.type('a1', 'ls')).resolves.toEqual({ kind: 'unreachable' })
  })

  it('the writes of one session leave in the order the keys were pressed', async () => {
    const bodies: string[] = []
    let resolveFirst: (response: Response) => void = () => undefined
    const posting = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string)
      if (bodies.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return new Response(JSON.stringify({ status: 'typed', id: 'a1' }), { status: 202 })
    })
    vi.stubGlobal('fetch', posting)

    const first = SessionsClient.type('a1', 'l')
    const second = SessionsClient.type('a1', 's')

    await flushMicrotasks()
    expect(bodies).toEqual([JSON.stringify({ text: 'l' })])

    resolveFirst(new Response(JSON.stringify({ status: 'typed', id: 'a1' }), { status: 202 }))
    await first
    await second

    expect(bodies).toEqual([JSON.stringify({ text: 'l' }), JSON.stringify({ text: 's' })])
  })

  it('the writes of two different sessions do not wait for each other', async () => {
    let resolveFirst: (response: Response) => void = () => undefined
    let firstSettled = false
    const posting = vi.fn(async (url: string) => {
      if (url === '/sessions/a1/input') {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return new Response(JSON.stringify({ status: 'typed', id: 'b2' }), { status: 202 })
    })
    vi.stubGlobal('fetch', posting)

    const first = SessionsClient.type('a1', 'l').then((outcome) => {
      firstSettled = true
      return outcome
    })
    const second = SessionsClient.type('b2', 's')

    await flushMicrotasks()

    expect(posting).toHaveBeenCalledWith('/sessions/b2/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 's' }),
    })
    expect(firstSettled).toBe(false)

    resolveFirst(new Response(JSON.stringify({ status: 'typed', id: 'a1' }), { status: 202 }))

    await expect(second).resolves.toEqual({ kind: 'typed' })
    await first
  })
})
