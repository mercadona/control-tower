import { act, renderHook } from '@testing-library/react'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { useWorkConclusion } from './useWorkConclusion'
import type { WorkIdentity } from './WorkProgress.types'

type Answer = { status: number; body: string }

class ConclusionScenario {
  readonly identity: WorkIdentity = WorkProgressMother.identity()
  answer: Answer | Error = WorkProgressMother.notFound()
  readonly requests = vi.fn(async (_input: string, _init?: RequestInit) => {
    if (this.answer instanceof Error) throw this.answer
    return new Response(this.answer.body, { status: this.answer.status })
  })

  install(): void {
    vi.stubGlobal('fetch', this.requests)
  }
}

describe('what became of a saved workflow no longer active', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks nothing while there is no saved workflow to ask about', async () => {
    const scenario = new ConclusionScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(null))
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toEqual({ kind: 'checking' })
    expect(scenario.requests).not.toHaveBeenCalled()
  })

  it('reads a work-not-found refusal as work the backend no longer knows', async () => {
    const scenario = new ConclusionScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toEqual({ kind: 'not-found' })
    expect(scenario.requests).toHaveBeenCalledWith(WorkProgressMother.PATH, expect.anything())
  })

  it('turns not found into finished once the backend records the harvest, and stops asking', async () => {
    const scenario = new ConclusionScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    scenario.answer = WorkProgressMother.finished()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toEqual({
      kind: 'finished', harvestedAt: WorkProgressMother.HARVESTED_AT, pullRequest: WorkProgressMother.PULL_REQUEST,
    })
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(scenario.requests).toHaveBeenCalledTimes(2)
  })

  it('keeps checking while the backend cannot be reached, and says nothing it was not told', async () => {
    const scenario = new ConclusionScenario()
    scenario.answer = new TypeError('Failed to fetch')
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toEqual({ kind: 'checking' })
    scenario.answer = WorkProgressMother.notFound()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toEqual({ kind: 'not-found' })
  })

  it('keeps the last conclusion when a later read fails', async () => {
    const scenario = new ConclusionScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    scenario.answer = new TypeError('Failed to fetch')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toEqual({ kind: 'not-found' })
  })

  it('does not announce the delivery of another conversation on the same issue', async () => {
    const scenario = new ConclusionScenario()
    scenario.answer = WorkProgressMother.finished({ agent: 'another-conversation' })
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toEqual({ kind: 'checking' })
  })

  it('keeps checking while the backend still reports the work in flight', async () => {
    const scenario = new ConclusionScenario()
    scenario.answer = WorkProgressMother.implementing()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toEqual({ kind: 'checking' })
    scenario.answer = WorkProgressMother.finished()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toMatchObject({ kind: 'finished' })
  })

  it('withdraws not found as soon as the backend reports the work in flight again', async () => {
    const scenario = new ConclusionScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkConclusion(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toEqual({ kind: 'not-found' })
    scenario.answer = WorkProgressMother.implementing()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toEqual({ kind: 'checking' })
  })
})
