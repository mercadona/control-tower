import { describe, expect, it } from 'vitest'
import { InspectedWorkInventory } from '../../src/infrastructure/inspected-work-inventory.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { PlanSessions } from '../../src/infrastructure/plan-sessions.ts'
import { PlanRecoveryConflict, WorkNotFound, WorkNotRead, WorkNotUnderstood } from '../../src/domain/exceptions.ts'
import { WorkProgressMother } from '../work-progress-mother.ts'

class InventoryScenario {
  readonly plans = new ActivePlans({ sessions: new PlanSessions() })
  diagnostic: string | null = null
  conflict: PlanRecoveryConflict | null = null
  readonly inventory = new InspectedWorkInventory({
    plans: this.plans,
    inspection: { inspect: async () => {
      if (this.conflict !== null) throw this.conflict
      return this.diagnostic
    } },
  })
}

describe('InspectedWorkInventory', () => {
  it('resolves equal issue numbers in different repositories to their own recorded work', async () => {
    const tested = new InventoryScenario()
    const first = WorkProgressMother.watch('first/repo')
    const second = WorkProgressMother.watch('second/repo')
    tested.plans.rememberPlanning(first)
    tested.plans.rememberImplementing(second, false)
    expect((await tested.inventory.find(7, first.repository)).condition.phase).toBe('planning')
    expect((await tested.inventory.find(7, second.repository)).condition.phase).toBe('implementing')
    expect((await tested.inventory.find(7, second.repository)).watch).toBe(second)
  })

  it('distinguishes missing work, unreadable evidence and conflicting identities', async () => {
    const tested = new InventoryScenario()
    const watch = WorkProgressMother.watch()
    await expect(tested.inventory.find(7, watch.repository)).rejects.toBeInstanceOf(WorkNotFound)
    tested.diagnostic = 'records unavailable'
    await expect(tested.inventory.find(7, watch.repository)).rejects.toBeInstanceOf(WorkNotRead)
    tested.conflict = new PlanRecoveryConflict('two conversations claim one issue')
    await expect(tested.inventory.find(7, watch.repository)).rejects.toBeInstanceOf(WorkNotUnderstood)
  })
})
