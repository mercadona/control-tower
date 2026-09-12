import { SessionsMother } from '__scenarios__/SessionsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { SessionsClient } from 'app/sessions/client'

const answering = (body: string) => vi.fn(async () => new Response(body))

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
      onBytes: (bytes) => received.push(bytes),
      onFailure: () => undefined,
      onRefused: () => undefined,
      onUnreachable: () => undefined,
    })
    FakeEventSource.last().receive('{"bytes":"hello"}')

    expect(received).toEqual(['hello'])
  })

  it('a connection the browser closed for good is a refusal', () => {
    FakeEventSource.install()
    let refusals = 0
    let unreachables = 0

    SessionsClient.watch('a1', {
      onBytes: () => undefined,
      onFailure: () => undefined,
      onRefused: () => (refusals += 1),
      onUnreachable: () => (unreachables += 1),
    })
    FakeEventSource.last().refuseBeforeOpen()

    expect(refusals).toBe(1)
    expect(unreachables).toBe(0)
  })

  it('typing posts the text as json to that session input', async () => {
    const posting = vi.fn(async () => new Response(JSON.stringify({ status: 'typed', id: 'a1' }), { status: 202 }))
    vi.stubGlobal('fetch', posting)

    await SessionsClient.type('a1', 'ls -la')

    expect(posting).toHaveBeenCalledWith('/sessions/a1/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ls -la' }),
    })
  })
})
