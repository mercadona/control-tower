import { act, renderHook } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { WorkProgressContract } from 'app/work-progress/contract'
import { WorkProgressPresentation } from 'app/work-progress/presentation'
import type { ActivePlan } from 'app/active-plans/ActivePlan.types'
import type { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import { useAutomaticSliceSelection } from './useAutomaticSliceSelection'

class SelectionScenario {
  readonly plans: ActivePlan[] = JSON.parse(HeadlessPlanMother.slicesInFlight(7, 8).body).plans
  readonly workflow = HeadlessPlanMother.workflowOfSlice(7)
  readonly onSelect = vi.fn()

  reading(index: number, answer = ImplementProgressMother.progress()): ImplementProgressRead {
    return WorkProgressPresentation.observation({
      kind: 'read', snapshot: WorkProgressContract.read(JSON.parse(WorkProgressMother.fromActive(this.plans[index], answer).body)),
    })
  }
}

describe('automatic slice selection freshness', () => {
  it.each([
    ['stale', { phase: 'unreachable' }],
    ['unavailable', { phase: 'unreachable' }],
    ['partial', { phase: 'failed', error: 'publication unavailable' }],
  ] satisfies Array<[string, ImplementProgressRead]>)('suspends a pending handoff while selected progress is %s and revalidates before selecting', async (_name, invalid) => {
    const scenario = new SelectionScenario()
    const { result } = renderHook(() => useAutomaticSliceSelection({
      workflow: scenario.workflow, plans: scenario.plans, enabled: true, onSelect: scenario.onSelect,
    }))
    await act(async () => {
      result.current(scenario.plans[0].plan, scenario.reading(0))
      result.current(scenario.plans[1].plan, { phase: 'waiting' })
    })
    await act(async () => result.current(scenario.plans[0].plan, scenario.reading(0, ImplementProgressMother.inReview())))
    expect(scenario.onSelect).not.toHaveBeenCalled()
    await act(async () => result.current(scenario.plans[0].plan, invalid))
    await act(async () => result.current(scenario.plans[1].plan, scenario.reading(1)))
    expect(scenario.onSelect).not.toHaveBeenCalled()
    await act(async () => result.current(scenario.plans[0].plan, scenario.reading(0, ImplementProgressMother.inReview())))
    expect(scenario.onSelect).toHaveBeenCalledExactlyOnceWith(scenario.plans[1])
  })
})
