import { renderHook } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { useCoordinatingSession } from 'app/coordinating-session/useCoordinatingSession'

const answerWith = (answer: { status: number; body: string }) =>
  vi.fn(async () => new Response(answer.body, { status: answer.status }))

describe('useCoordinatingSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reads the state on mount', async () => {
    const reading = answerWith(CoordinatingSessionMother.none())
    vi.stubGlobal('fetch', reading)

    renderHook(() => useCoordinatingSession())

    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
  })

  it('reads again every two seconds', async () => {
    const reading = answerWith(CoordinatingSessionMother.none())
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(2000)

    expect(reading).toHaveBeenCalledTimes(2)
  })

  it('stops reading on unmount', async () => {
    const reading = answerWith(CoordinatingSessionMother.none())
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(2000)

    expect(reading).toHaveBeenCalledTimes(1)
  })
})
