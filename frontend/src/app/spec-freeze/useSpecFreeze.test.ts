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

  it('stops asking once the spec is frozen', async () => {
    const reading = answerWith(SpecFreezeMother.frozen())
    vi.stubGlobal('fetch', reading)
    vi.useFakeTimers()

    renderHook(() => useSpecFreeze())
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(2000)

    expect(reading).toHaveBeenCalledTimes(1)
  })
})
