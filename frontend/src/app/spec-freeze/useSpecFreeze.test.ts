import { act, renderHook } from '@testing-library/react'
import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { useSpecFreeze } from 'app/spec-freeze/useSpecFreeze'

const answerWith = (answer: { status: number; body: string }) =>
  vi.fn(async () => new Response(answer.body, { status: answer.status }))

describe('useSpecFreeze', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows a read that names no coordinating target while it watches none', async () => {
    vi.stubGlobal('fetch', answerWith(SpecFreezeMother.frozenWithoutSession()))

    const { result } = renderHook(() => useSpecFreeze(null))

    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'frozen', target: null }))
  })

  it('drops a read that names a coordinating target while it watches none', async () => {
    vi.stubGlobal('fetch', answerWith(SpecFreezeMother.frozen()))

    const { result } = renderHook(() => useSpecFreeze(null))

    await vi.waitFor(() => expect(result.current).toEqual({ phase: 'read', kind: 'none' }))
  })

  it('forgets the read of the previous coordinating target as soon as it watches another one', async () => {
    let answer: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(SpecFreezeMother.frozen().body, { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve })))
    const { result, rerender } = renderHook(({ target }) => useSpecFreeze(target), {
      initialProps: { target: SpecFreezeMother.TARGET as string | null },
    })
    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'frozen' }))

    rerender({ target: 'another-target' })

    expect(result.current).toEqual({ phase: 'connecting' })
    answer(new Response(SpecFreezeMother.frozen().body, { status: 200 }))
  })

  it('keeps what it last read of the same target while the backend cannot be reached', async () => {
    vi.useFakeTimers()
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(SpecFreezeMother.draftReady().body, { status: 200 }))
      .mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useSpecFreeze(SpecFreezeMother.TARGET))
    await vi.waitFor(() => expect(result.current).toMatchObject({ phase: 'read', kind: 'draft' }))

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current).toMatchObject({ phase: 'read', kind: 'draft' })
  })

  it('stops asking once the spec is frozen', async () => {
    const reading = answerWith(SpecFreezeMother.frozen())
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useSpecFreeze(SpecFreezeMother.TARGET))
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(2000)

    expect(reading).toHaveBeenCalledTimes(1)
  })
})
