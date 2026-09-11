import { renderHook } from '@testing-library/react'
import { ImplementHistoryMother } from '__scenarios__/ImplementHistoryMother'
import { useImplementHistory } from 'app/implement-history/useImplementHistory'

const answerWith = (answer: { status: number; body: string }) =>
  vi.fn(async () => new Response(answer.body, { status: answer.status }))

describe('useImplementHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('should poll again after the interval while the run keeps going', async () => {
    const fetching = answerWith(ImplementHistoryMother.oneTask())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => useImplementHistory(ImplementHistoryMother.ISSUE, ImplementHistoryMother.ROOT, ImplementHistoryMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('should keep the previous rows on a not-read refusal instead of clearing them', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(ImplementHistoryMother.oneTask().body, { status: 200 }))
      .mockResolvedValue(new Response(ImplementHistoryMother.refusedNotRead().body, { status: 400 }))
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    const { result } = renderHook(() => useImplementHistory(ImplementHistoryMother.ISSUE, ImplementHistoryMother.ROOT, ImplementHistoryMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(result.current.phase).toBe('read'))
    const readRows = result.current.phase === 'read' ? result.current.entries : []
    expect(readRows).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(2))

    expect(result.current.phase).toBe('read')
    expect(result.current.phase === 'read' ? result.current.entries : []).toHaveLength(1)
  })

  it('should keep polling after a refusal other than not-read', async () => {
    const fetching = answerWith(ImplementHistoryMother.refusedMalformedRepo())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => useImplementHistory(ImplementHistoryMother.ISSUE, ImplementHistoryMother.ROOT, ImplementHistoryMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('should stop polling once the component unmounts', async () => {
    const fetching = answerWith(ImplementHistoryMother.empty())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useImplementHistory(ImplementHistoryMother.ISSUE, ImplementHistoryMother.ROOT, ImplementHistoryMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })
})
