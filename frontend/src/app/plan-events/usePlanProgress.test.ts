import { act, renderHook } from '@testing-library/react'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { usePlanProgress } from 'app/plan-events/usePlanProgress'

const renderProgress = () => renderHook(() => usePlanProgress(PlanEventsMother.ISSUE, 'owner/name'))

describe('usePlanProgress', () => {
  beforeEach(() => {
    FakeEventSource.install()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const connect = async () => {
    await act(async () => vi.runOnlyPendingTimersAsync())
  }

  it('should start as connecting', async () => {
    const { result } = renderProgress()

    expect(result.current).toEqual({ phase: 'connecting' })
  })

  it('should move to writing once the first frame arrives', async () => {
    const { result } = renderProgress()
    await connect()

    act(() => FakeEventSource.last().receive(PlanEventsMother.writing()))

    expect(result.current).toEqual({ phase: 'writing' })
  })

  it('should show a failure with its code and detail, without giving up', async () => {
    const { result } = renderProgress()
    await connect()

    act(() => FakeEventSource.last().failWith(PlanEventsMother.unreadable()))

    expect(result.current).toEqual({
      phase: 'failed',
      code: 'plan-progress-not-read',
      detail: 'git status could not say whether the plan is committed',
    })

    act(() => FakeEventSource.last().receive(PlanEventsMother.writing()))

    expect(result.current).toEqual({ phase: 'writing' })
  })

  it('should say the backend refused the plan when the connection fails for good', async () => {
    const { result } = renderProgress()
    await connect()

    act(() => FakeEventSource.last().refuseBeforeOpen())

    expect(result.current).toEqual({ phase: 'refused' })
  })

  it('should say the backend is unreachable when the connection drops without a body', async () => {
    const { result } = renderProgress()
    await connect()

    act(() => FakeEventSource.last().dropConnection())

    expect(result.current).toEqual({ phase: 'unreachable' })
  })
})
