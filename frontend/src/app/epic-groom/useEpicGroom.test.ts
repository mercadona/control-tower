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

  it('while the slicing is being reviewed it keeps asking at a rung it would otherwise rest at', async () => {
    const reading = vi.fn(async () => responseFor(EpicGroomMother.groomable()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useEpicGroom(true))
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(3)
  })

  it('it rests at a rung no conversation can change any more, review or no review', async () => {
    const reading = vi.fn(async () => responseFor(EpicGroomMother.groomed()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useEpicGroom(true))
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('a review that begins after the read has already rested wakes it up again', async () => {
    const reading = vi.fn(async () => responseFor(EpicGroomMother.groomable()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    const { rerender } = renderHook(({ watching }: { watching: boolean }) => useEpicGroom(watching), {
      initialProps: { watching: false },
    })
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(1)

    rerender({ watching: true })
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(2))

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
