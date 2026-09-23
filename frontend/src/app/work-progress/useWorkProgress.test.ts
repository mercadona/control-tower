import { act, renderHook } from '@testing-library/react'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { useWorkProgress } from './useWorkProgress'
import type { WorkIdentity } from './WorkProgress.types'

class ProgressScenario {
  readonly identity: WorkIdentity = {
    repo: WorkProgressMother.active('planning').plan.repo,
    issue: WorkProgressMother.active('planning').plan.issue.number,
    agent: WorkProgressMother.active('planning').plan.agent,
  }
  answer = WorkProgressMother.planning()
  failure: Error | null = null
  readonly requests = vi.fn(async (_input: string, _init?: RequestInit) => {
    if (this.failure !== null) throw this.failure
    return new Response(this.answer.body, { status: this.answer.status })
  })

  install(): void {
    vi.stubGlobal('fetch', this.requests)
  }
}

class HeldProgress {
  readonly pending: Array<(response: Response) => void> = []
  readonly fetch = vi.fn((_input: string, _init?: RequestInit) => new Promise<Response>((resolve) => this.pending.push(resolve)))

  answer(index: number, agent: string): void {
    const body = JSON.parse(WorkProgressMother.planning().body)
    body.agent = agent
    this.pending[index](new Response(JSON.stringify(body)))
  }
}

describe('unified work polling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the last reading explicitly stale on failure and recovers on the next poll', async () => {
    const scenario = new ProgressScenario()
    scenario.install()
    const { result } = renderHook(() => useWorkProgress(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toMatchObject({ kind: 'read', snapshot: { progress: { phase: 'planning' } } })
    scenario.failure = new TypeError('connection lost')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toMatchObject({ kind: 'stale', snapshot: { progress: { phase: 'planning' } }, detail: 'No se pudo contactar con el backend' })
    scenario.failure = null
    scenario.answer = WorkProgressMother.implementing()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current).toMatchObject({ kind: 'read', snapshot: { progress: { phase: 'implementing' } } })
  })

  it('retries an initial failure instead of permanently stopping the planning panel', async () => {
    const scenario = new ProgressScenario()
    scenario.failure = new TypeError('offline')
    scenario.install()
    const { result } = renderHook(() => useWorkProgress(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current.kind).toBe('unavailable')
    scenario.failure = null
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(result.current.kind).toBe('read')
  })

  it('uses the review cadence and aborts outstanding work when unmounted', async () => {
    const scenario = new ProgressScenario()
    scenario.answer = WorkProgressMother.implementing(ImplementProgressMother.inReview())
    scenario.install()
    const { unmount } = renderHook(() => useWorkProgress(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(14999))
    expect(scenario.requests).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(scenario.requests).toHaveBeenCalledTimes(2)
    unmount()
    expect(scenario.requests.mock.calls[1][1]?.signal?.aborted).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(scenario.requests).toHaveBeenCalledTimes(2)
  })

  it('does not accept progress from a different agent with the same repository and issue', async () => {
    const scenario = new ProgressScenario()
    const body = JSON.parse(scenario.answer.body)
    body.agent = 'replaced-agent'
    scenario.answer = { status: 200, body: JSON.stringify(body) }
    scenario.install()
    const { result } = renderHook(() => useWorkProgress(scenario.identity))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current.kind).toBe('unavailable')
  })

  it('ignores a late response from the previously selected conversation', async () => {
    const scenario = new ProgressScenario()
    const held = new HeldProgress()
    vi.stubGlobal('fetch', held.fetch)
    const { result, rerender } = renderHook(({ identity }) => useWorkProgress(identity), { initialProps: { identity: scenario.identity } })
    await act(async () => vi.advanceTimersByTimeAsync(0))
    rerender({ identity: { ...scenario.identity, agent: 'new-conversation' } })
    expect(held.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => held.answer(0, scenario.identity.agent))
    expect(result.current.kind).toBe('connecting')
    await act(async () => held.answer(1, 'new-conversation'))
    expect(result.current).toMatchObject({ kind: 'read', snapshot: { agent: 'new-conversation' } })
  })
})
