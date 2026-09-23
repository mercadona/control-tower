import { renderHook } from '@testing-library/react'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { usePlanningProgress } from 'app/planning-progress/usePlanningProgress'

const answerWith = (answer: { status: number; body: string }) =>
  vi.fn(async () => new Response(answer.body, { status: answer.status }))

describe('usePlanningProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('should poll again after the interval while the agent is still running', async () => {
    const fetching = answerWith(PlanningProgressMother.running())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(2)
  })

  it('should stop polling once the agent has finished', async () => {
    const fetching = answerWith(PlanningProgressMother.finished())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should keep polling while the conversation has no recorded planning call yet, instead of treating it as a stop condition', async () => {
    const fetching = answerWith(PlanningProgressMother.notRead())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)
    expect(fetching).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(fetching).toHaveBeenCalledTimes(3)
  })

  it('should stop polling once this process is found not to be watching that issue', async () => {
    const fetching = answerWith(PlanningProgressMother.notWatched())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should stop polling once the backend refuses the request for good', async () => {
    const fetching = answerWith(PlanningProgressMother.malformedRepo())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it('should stop polling once the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    vi.useFakeTimers()

    renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(3000)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('should stop polling once the component unmounts', async () => {
    const fetching = answerWith(PlanningProgressMother.running())
    vi.stubGlobal('fetch', fetching)
    vi.useFakeTimers()

    const { unmount } = renderHook(() => usePlanningProgress(PlanningProgressMother.ISSUE, PlanningProgressMother.REPO))
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(3000)

    expect(fetching).toHaveBeenCalledTimes(1)
  })
})
