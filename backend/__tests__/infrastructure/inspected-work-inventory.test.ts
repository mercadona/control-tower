import { describe, expect, it } from 'vitest'
import { InspectedWorkInventory } from '../../src/infrastructure/inspected-work-inventory.ts'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { PlanSessions } from '../../src/infrastructure/plan-sessions.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { RunDelivery } from '../../src/domain/ports/run-delivery.ts'
import {
  PlanAgentNotLaunched, PlanAgentNotNamed, PlanRecoveryConflict, WorkNotFound, WorkNotRead, WorkNotUnderstood,
} from '../../src/domain/exceptions.ts'
import { HarvestedWork } from '../../src/domain/value-objects/harvested-work.ts'
import type { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import type { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import {
  RunDeliveryUncertain, type DeliveredPullRequest, type RunDeliveryInspection,
} from '../../src/domain/value-objects/run-delivery.ts'
import { WorkProgressMother } from '../work-progress-mother.ts'

class HarvestedRecords extends PlanRecords {
  readonly asked: { issue: number, repository: RepositoryName }[] = []
  harvest: HarvestedWork | Error | null = null

  async harvested(asked: { issue: number, repository: RepositoryName }): Promise<HarvestedWork | null> {
    this.asked.push(asked)
    if (this.harvest instanceof Error) throw this.harvest
    return this.harvest
  }
}

class RecordedDelivery extends RunDelivery {
  readonly asked: PlanWatch[] = []
  pullRequest: DeliveredPullRequest | Error | null = null

  override async deliver(): Promise<void> {
    throw new Error('a read never delivers')
  }

  override async inspect(): Promise<RunDeliveryInspection> {
    throw new Error('a finished slice is never inspected')
  }

  override async recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null> {
    this.asked.push(watch)
    if (this.pullRequest instanceof Error) throw this.pullRequest
    return this.pullRequest
  }
}

class InventoryScenario {
  readonly plans = new ActivePlans({ sessions: new PlanSessions() })
  readonly records = new HarvestedRecords()
  readonly delivery = new RecordedDelivery()
  diagnostic: string | null = null
  conflict: PlanRecoveryConflict | null = null
  readonly inventory = new InspectedWorkInventory({
    plans: this.plans,
    records: this.records,
    delivery: this.delivery,
    inspection: { inspect: async () => {
      if (this.conflict !== null) throw this.conflict
      return this.diagnostic
    } },
  })

  harvested(watch = WorkProgressMother.watch()): PlanWatch {
    this.records.harvest = new HarvestedWork({ watch, harvestedAt: WorkProgressMother.HARVESTED_AT })
    return watch
  }
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

  it('answers finished, with the pull request its journal names, for a harvested slice no longer active', async () => {
    const tested = new InventoryScenario()
    const watch = tested.harvested()
    tested.delivery.pullRequest = WorkProgressMother.pullRequest()

    const found = await tested.inventory.find(7, watch.repository)

    expect(found.watch).toBe(watch)
    expect(found.condition).toEqual({
      phase: 'finished', harvestedAt: WorkProgressMother.HARVESTED_AT, pullRequest: WorkProgressMother.pullRequest(),
    })
    expect(tested.records.asked).toEqual([{ issue: 7, repository: watch.repository }])
    expect(tested.delivery.asked).toEqual([watch])
  })

  it('answers finished with no pull request for a slice delivered outside the backend', async () => {
    const tested = new InventoryScenario()
    const watch = tested.harvested()

    expect((await tested.inventory.find(7, watch.repository)).condition).toEqual({
      phase: 'finished', harvestedAt: WorkProgressMother.HARVESTED_AT, pullRequest: null,
    })
  })

  it('never reads an active slice as finished, and does not look for its harvest', async () => {
    const tested = new InventoryScenario()
    const watch = tested.harvested()
    tested.plans.rememberImplementing(watch, false)

    expect((await tested.inventory.find(7, watch.repository)).condition.phase).toBe('implementing')
    expect(tested.records.asked).toEqual([])
  })

  it('does not look for the harvest of a slice whose evidence could not be inspected', async () => {
    const tested = new InventoryScenario()
    tested.harvested()
    tested.diagnostic = 'records unavailable'

    await expect(tested.inventory.find(7, WorkProgressMother.watch().repository)).rejects.toBeInstanceOf(WorkNotRead)
    expect(tested.records.asked).toEqual([])
  })

  it.each([
    ['an unreadable harvest receipt', (tested: InventoryScenario) => {
      tested.records.harvest = new PlanAgentNotNamed('harvest.json cannot be read as a harvest receipt')
    }],
    ['a disk that refuses the read', (tested: InventoryScenario) => {
      tested.records.harvest = new PlanAgentNotLaunched('harvest.json could not be read')
    }],
    ['a delivery receipt that cannot be proven', (tested: InventoryScenario) => {
      tested.harvested()
      tested.delivery.pullRequest = new RunDeliveryUncertain('delivery receipt is malformed')
    }],
  ])('reads %s as not read, never as finished nor as missing', async (_case, arrange) => {
    const tested = new InventoryScenario()
    arrange(tested)

    const refusal = await tested.inventory.find(7, WorkProgressMother.watch().repository).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkNotRead)
    expect(refusal).not.toBeInstanceOf(WorkNotFound)
  })

  it('lets a defect of ours rise instead of reading it as unread evidence', async () => {
    const tested = new InventoryScenario()
    const defect = new TypeError('records is not iterable')
    tested.records.harvest = defect

    await expect(tested.inventory.find(7, WorkProgressMother.watch().repository)).rejects.toBe(defect)
  })
})
