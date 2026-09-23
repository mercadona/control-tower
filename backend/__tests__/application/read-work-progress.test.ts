import { describe, expect, it } from 'vitest'
import { ReadWorkProgress, ReadWorkProgressParams } from '../../src/application/queries/read-work-progress.ts'
import type { ReadImplementationProgressParams } from '../../src/application/queries/read-implementation-progress.ts'
import { PlanProgressNotRead, PlanningActivityNotRead, WorkNotFound } from '../../src/domain/exceptions.ts'
import { TrackedWork, type WorkCondition } from '../../src/domain/value-objects/tracked-work.ts'
import { WorkProgressMother } from '../work-progress-mother.ts'

class WorkScenario {
  readonly watch = WorkProgressMother.watch()
  condition: WorkCondition = { phase: 'planning' }
  planFailure: Error | null = null
  activityFailure: Error | null = null
  inventoryFailure: Error | null = null
  readonly executionRequests: ReadImplementationProgressParams[] = []
  planReads = 0
  activityReads = 0
  readonly query = new ReadWorkProgress({
    inventory: { find: async () => {
      if (this.inventoryFailure !== null) throw this.inventoryFailure
      return new TrackedWork(this.watch, this.condition)
    } },
    plans: { of: async () => {
      this.planReads += 1
      if (this.planFailure !== null) throw this.planFailure
      return 'ready'
    } },
    activities: { of: async () => {
      this.activityReads += 1
      if (this.activityFailure !== null) throw this.activityFailure
      return WorkProgressMother.activity()
    } },
    implementation: { execute: async (params) => {
      this.executionRequests.push(params)
      return { state: WorkProgressMother.execution(), delivery: { kind: 'verified' as const } }
    } },
  })

  async read() {
    return this.query.execute(new ReadWorkProgressParams(this.watch.issue.number, this.watch.repository))
  }
}

describe('ReadWorkProgress', () => {
  it('reports document readiness and activity independently in the same planning response', async () => {
    const tested = new WorkScenario()
    const result = await tested.read()
    expect(result.progress.detail).toEqual({
      phase: 'planning', plan: { kind: 'available', value: 'ready' },
      activity: { kind: 'available', value: WorkProgressMother.activity() },
    })
    expect(tested.executionRequests).toEqual([])
  })

  it.each(['plan', 'activity'] as const)('a failed %s read leaves the other planning information available', async (part) => {
    const tested = new WorkScenario()
    if (part === 'plan') tested.planFailure = new PlanProgressNotRead('plan unreadable')
    else tested.activityFailure = new PlanningActivityNotRead('activity unreadable')
    const { progress } = await tested.read()
    expect(progress.detail).toMatchObject({ [part]: { kind: 'unavailable', detail: `${part} unreadable` } })
    expect(progress.detail).toMatchObject({ [part === 'plan' ? 'activity' : 'plan']: { kind: 'available' } })
  })

  it('execution uses the recorded checkout and never queries planning sources', async () => {
    const tested = new WorkScenario()
    tested.condition = { phase: 'implementing', acceptsChange: false }
    const result = await tested.read()
    expect(tested.executionRequests[0].root.text).toBe('/recorded/checkout')
    expect(result.progress.detail).toMatchObject({ phase: 'implementing', execution: { kind: 'available' } })
    expect(tested.planReads).toBe(0)
    expect(tested.activityReads).toBe(0)
  })

  it('uncertain work carries its recorded recovery without trying to execute or reinterpret it', async () => {
    const tested = new WorkScenario()
    tested.condition = { phase: 'uncertain', diagnostic: 'unowned call', recovery: { action: 'inspect', detail: 'inspect evidence' }, refusal: null }
    expect((await tested.read()).progress.detail).toEqual(tested.condition)
    expect(tested.executionRequests).toEqual([])
    expect(tested.planReads).toBe(0)
  })

  it('missing identity refuses before any progress reader is consulted', async () => {
    const tested = new WorkScenario()
    tested.inventoryFailure = new WorkNotFound('not found')
    await expect(tested.read()).rejects.toThrow(WorkNotFound)
    expect(tested.planReads).toBe(0)
    expect(tested.activityReads).toBe(0)
    expect(tested.executionRequests).toEqual([])
  })
})
