import { renderHook, waitFor } from '@testing-library/react'
import { SessionsMother } from '__scenarios__/SessionsMother'
import { useLiveSessions } from 'app/sessions/useLiveSessions'

describe('useLiveSessions', () => {
  afterEach(() => vi.unstubAllGlobals())

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
})
