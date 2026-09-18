import { act, renderHook, waitFor } from '@testing-library/react'
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

    expect(result.current.state).toEqual({ status: 'loading', sessions: [] })
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

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable', sessions: [] }))
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

  it('a delayed listing cannot resurrect a session removed by closure', async () => {
    let answerFirst: (response: Response) => void = () => undefined
    const first = new Promise<Response>((resolve) => { answerFirst = resolve })
    const listing = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response(SessionsMother.noSessions().body))
    vi.stubGlobal('fetch', listing)
    const { result, rerender } = renderHook(
      ({ removedSessionIds }) => useLiveSessions({ removedSessionIds }),
      { initialProps: { removedSessionIds: [] as string[] } },
    )
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(1))

    rerender({ removedSessionIds: ['a1'] })
    act(() => result.current.refresh())
    expect(result.current.state.sessions).toEqual([])
    await act(async () => answerFirst(new Response(SessionsMother.oneSession().body)))

    await waitFor(() => expect(result.current.state).toEqual({ status: 'loaded', sessions: [] }))
  })

  it('a deferred empty listing cannot erase an authoritative adoption', async () => {
    let answer: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve })))
    const adopted = { id: 'coordinator', name: 'brainstorming' }
    const { result, rerender } = renderHook(
      ({ session }) => useLiveSessions({ adopted: session }),
      { initialProps: { session: null as typeof adopted | null } },
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    rerender({ session: adopted })
    await waitFor(() => expect(result.current.state.sessions).toEqual([adopted]))
    await act(async () => answer(new Response(SessionsMother.noSessions().body)))

    expect(result.current.state).toEqual({ status: 'loaded', sessions: [adopted] })
  })

  it('a listing error keeps an adopted interactive session mounted', async () => {
    const adopted = { id: 'coordinator', name: 'brainstorming' }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))

    const { result } = renderHook(() => useLiveSessions({ adopted }))

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable', sessions: [adopted] }))
  })

  it('suppresses every confirmed-closed ID from later listings and adoption', async () => {
    const two = JSON.stringify({ sessions: [{ id: 'a1', name: 'zsh' }, { id: 'b2', name: 'bash' }] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(two)))
    const { result, rerender } = renderHook(
      ({ removedSessionIds, adopted }) => useLiveSessions({ removedSessionIds, adopted }),
      { initialProps: { removedSessionIds: ['a1'], adopted: null as { id: string; name: string } | null } },
    )
    await waitFor(() => expect(result.current.state.sessions).toEqual([{ id: 'b2', name: 'bash' }]))

    rerender({ removedSessionIds: ['a1', 'b2'], adopted: { id: 'a1', name: 'zsh' } })

    expect(result.current.state.sessions).toEqual([])
  })

  it('coalesces refreshes while one listing is in flight', async () => {
    let answer: (response: Response) => void = () => undefined
    const listing = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve }))
      .mockResolvedValue(new Response(SessionsMother.noSessions().body))
    vi.stubGlobal('fetch', listing)
    const { result } = renderHook(() => useLiveSessions())
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.refresh()
      result.current.refresh()
    })
    expect(listing).toHaveBeenCalledTimes(1)
    await act(async () => answer(new Response(SessionsMother.noSessions().body)))

    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2))
  })
})
