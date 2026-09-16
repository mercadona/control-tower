import { renderHook, waitFor } from '@testing-library/react'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { useLiveSessions } from 'app/sessions/useLiveSessions'

const answeringInTurn = (bodies: string[]) => {
  let call = 0
  return vi.fn(async () => {
    const body = bodies[call] ?? bodies[bodies.length - 1]
    call += 1
    return new Response(body)
  })
}

describe('useLiveSessions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('the hook starts loading and ends with what the backend listed', async () => {
    const { body } = SessionsMother.oneSession()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))

    const { result } = renderHook(() => useLiveSessions())

    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.state).toEqual({
      status: 'loaded',
      sessions: [{ id: 'a1', name: 'zsh' }],
    }))
  })

  it('an unreachable backend leaves it unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const { result } = renderHook(() => useLiveSessions())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }))
  })

  it('refresh asks the backend again', async () => {
    const listing = vi.fn(async () => new Response(SessionsMother.oneSession().body))
    vi.stubGlobal('fetch', listing)

    const { result } = renderHook(() => useLiveSessions())
    await waitFor(() => expect(result.current.state.status).toBe('loaded'))

    result.current.refresh()

    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2))
  })

  it('polling asks again after the interval', async () => {
    const listing = answeringInTurn([SessionsMother.noSessions().body])
    vi.stubGlobal('fetch', listing)
    vi.useFakeTimers()

    renderHook(() => useLiveSessions())
    await vi.waitFor(() => expect(listing).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(listing).toHaveBeenCalledTimes(2)
  })

  it('a session that appears between polls is picked up with nobody calling refresh', async () => {
    const listing = answeringInTurn([SessionsMother.noSessions().body, SessionsMother.oneSession().body])
    vi.stubGlobal('fetch', listing)
    vi.useFakeTimers()

    const { result } = renderHook(() => useLiveSessions())
    await vi.waitFor(() => expect(result.current.state).toEqual({ status: 'loaded', sessions: [] }))

    await vi.advanceTimersByTimeAsync(3000)

    await vi.waitFor(() => expect(result.current.state).toEqual({
      status: 'loaded',
      sessions: [{ id: 'a1', name: 'zsh' }],
    }))
  })

  it('unmounting stops the chain', async () => {
    const listing = answeringInTurn([SessionsMother.noSessions().body])
    vi.stubGlobal('fetch', listing)
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useLiveSessions())
    await vi.waitFor(() => expect(listing).toHaveBeenCalledTimes(1))
    unmount()

    await vi.advanceTimersByTimeAsync(3000)

    expect(listing).toHaveBeenCalledTimes(1)
  })

  it('refresh polls without waiting for the interval boundary', async () => {
    const listing = answeringInTurn([SessionsMother.noSessions().body])
    vi.stubGlobal('fetch', listing)
    vi.useFakeTimers()

    const { result } = renderHook(() => useLiveSessions())
    await vi.waitFor(() => expect(listing).toHaveBeenCalledTimes(1))

    result.current.refresh()

    await vi.waitFor(() => expect(listing).toHaveBeenCalledTimes(2))
  })

  it('refresh right before a scheduled poll does not double the request', async () => {
    const listing = answeringInTurn([SessionsMother.noSessions().body])
    vi.stubGlobal('fetch', listing)
    vi.useFakeTimers()

    const { result } = renderHook(() => useLiveSessions())
    await vi.advanceTimersByTimeAsync(0)
    expect(listing).toHaveBeenCalledTimes(1)

    result.current.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(listing).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3000)

    expect(listing).toHaveBeenCalledTimes(3)
  })
})
