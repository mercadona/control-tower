import { renderHook } from '@testing-library/react'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { useEpicGroom } from 'app/epic-groom/useEpicGroom'

const POLL_INTERVAL_MS = 10000

const responseFor = (answer: { status: number; body: string }): Response =>
  new Response(answer.body, { status: answer.status })

describe('useEpicGroom', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stops asking once there is something to press and keeps asking while it waits', async () => {
    const reading = vi
      .fn()
      .mockResolvedValueOnce(responseFor(EpicGroomMother.awaitingPublication()))
      .mockResolvedValueOnce(responseFor(EpicGroomMother.awaitingPublication()))
      .mockResolvedValue(responseFor(EpicGroomMother.groomable()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useEpicGroom())
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(3)
  })

  it('a fetch that throws leaves the read unavailable and keeps polling', async () => {
    const reading = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    const { result } = renderHook(() => useEpicGroom())
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(result.current).toEqual({ phase: 'read', kind: 'unavailable' }))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(2)
  })
})
