import { act, renderHook } from '@testing-library/react'
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

  it('shows a read that names no coordinating target while it watches none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFor(EpicGroomMother.groomableWithoutSession())))

    const { result } = renderHook(() => useEpicGroom(false, null))

    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable', target: null }))
  })

  it('drops a read that names a coordinating target while it watches none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFor(EpicGroomMother.groomable())))

    const { result } = renderHook(() => useEpicGroom(false, null))

    await vi.waitFor(() => expect(result.current).toEqual({ phase: 'read', kind: 'none' }))
  })

  it('forgets the read of the previous coordinating target as soon as it watches another one', async () => {
    let answer: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(responseFor(EpicGroomMother.groomable()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve })))
    const { result, rerender } = renderHook(({ target }) => useEpicGroom(false, target), {
      initialProps: { target: EpicGroomMother.TARGET as string | null },
    })
    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable' }))

    rerender({ target: 'another-target' })

    expect(result.current).toEqual({ phase: 'connecting' })
    answer(responseFor(EpicGroomMother.groomable()))
  })

  it('keeps the read it has when only what it watches for changes, so the panel does not blank out', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(responseFor(EpicGroomMother.groomable()))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined)))
    const { result, rerender } = renderHook(({ reviewing }) => useEpicGroom(reviewing, EpicGroomMother.TARGET), {
      initialProps: { reviewing: false },
    })
    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable' }))

    rerender({ reviewing: true })

    expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable' })
  })

  it('keeps what it last read of the same target while the backend cannot be reached', async () => {
    vi.useFakeTimers()
    const fetching = vi.fn()
      .mockResolvedValueOnce(responseFor(EpicGroomMother.groomable()))
      .mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useEpicGroom(true, EpicGroomMother.TARGET))
    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable' }))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current).toMatchObject({ phase: 'read', kind: 'groomable' })
  })

  it('drops a read that names no coordinating target while it watches one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFor(EpicGroomMother.groomableWithoutSession())))

    const { result } = renderHook(() => useEpicGroom(false, EpicGroomMother.TARGET))

    await vi.waitFor(() => expect(result.current).toEqual({ phase: 'read', kind: 'none' }))
  })

  it('stops asking once there is something to press and keeps asking while it waits', async () => {
    const reading = vi
      .fn()
      .mockResolvedValueOnce(responseFor(EpicGroomMother.awaitingPublication()))
      .mockResolvedValueOnce(responseFor(EpicGroomMother.awaitingPublication()))
      .mockResolvedValue(responseFor(EpicGroomMother.groomable()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useEpicGroom(false, EpicGroomMother.TARGET))
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

    renderHook(() => useEpicGroom(true, EpicGroomMother.TARGET))
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

    renderHook(() => useEpicGroom(true, EpicGroomMother.TARGET))
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('a review that begins after the read has already rested wakes it up again', async () => {
    const reading = vi.fn(async () => responseFor(EpicGroomMother.groomable()))
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    const { rerender } = renderHook(({ watching }: { watching: boolean }) => useEpicGroom(watching, EpicGroomMother.TARGET), {
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
