import { renderHook } from '@testing-library/react'
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
