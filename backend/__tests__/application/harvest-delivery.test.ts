import { describe, it, expect } from 'vitest'
import { HarvestDelivery, HarvestDeliveryParams } from '../../src/application/actions/harvest-delivery.ts'
import { Harvest } from '../../src/domain/ports/harvest.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { HarvestOutcome, type HarvestOutcomeValue } from '../../src/domain/value-objects/harvest-outcome.ts'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { HarvestNotRead, HarvestNotRecorded } from '../../src/domain/exceptions.ts'

type HarvestSubject = Parameters<Harvest['collect']>[0]
type HarvestRecorded = Parameters<PlanRecords['recordHarvest']>[0]

class PlanRecordsDouble extends PlanRecords {
  readonly harvests: HarvestRecorded[] = []
  readonly refusal: Error | null

  constructor(refusal: Error | null = null) {
    super()
    this.refusal = refusal
  }

  async recordHarvest(asked: HarvestRecorded): Promise<void> {
    this.harvests.push(asked)
    if (this.refusal !== null) throw this.refusal
  }
}

class HarvestDouble extends Harvest {
  static ROOT = '/repo/checkout'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static PREPARED = new PreparedWorkspace({
    issueNumber: 42,
    located: new WorkspaceLocation({
      root: HarvestDouble.ROOT, path: `${HarvestDouble.ROOT}/.worktrees/42`, branch: 'feat/42',
    }),
  })

  readonly answer: HarvestOutcomeValue | Error
  readonly asked: HarvestSubject[]
  readonly records: PlanRecordsDouble

  constructor(answer: HarvestOutcomeValue | Error, records = new PlanRecordsDouble()) {
    super()
    this.answer = answer
    this.asked = []
    this.records = records
  }

  static answering(outcome: HarvestOutcomeValue) {
    return new HarvestDouble(outcome)
  }

  static unable(said: string) {
    return new HarvestDouble(new HarvestNotRead(said))
  }

  static collectedButNotRecorded(said: string) {
    return new HarvestDouble(HarvestOutcome.COLLECTED, new PlanRecordsDouble(new HarvestNotRecorded(said)))
  }

  async collect(subject: HarvestSubject): Promise<HarvestOutcomeValue> {
    this.asked.push(subject)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }

  harvested(prepared = HarvestDouble.PREPARED) {
    return new HarvestDelivery({ harvest: this, records: this.records })
      .execute(new HarvestDeliveryParams({ prepared, repository: HarvestDouble.REPOSITORY }))
  }

  refusal() {
    return this.harvested().catch((cause) => cause)
  }
}

describe('HarvestDelivery', () => {
  it('what_the_plugin_answered_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const harvested = await HarvestDouble.answering(HarvestOutcome.COLLECTED).harvested()

    expect(harvested.outcome).toBe(HarvestOutcome.COLLECTED)
  })

  it('the_plugin_is_asked_for_the_issue_number_of_the_workspace_and_never_for_the_workspace_itself', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested()

    expect(harvest.asked).toEqual([{ issueNumber: 42, repository: HarvestDouble.REPOSITORY, root: '/repo/checkout' }])
  })

  it('the_repository_the_survey_named_is_the_one_the_plugin_is_told_so_no_harvest_reaches_a_stranger', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.COLLECTED)

    await harvest.harvested()

    expect(harvest.asked[0].repository.text).toBe('josemerca/ct-loop-sandbox')
  })

  it('each_prepared_workspace_is_harvested_under_its_own_number_and_not_under_the_first_one_asked_for', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested(new PreparedWorkspace({
      issueNumber: 7,
      located: new WorkspaceLocation({
        root: HarvestDouble.ROOT, path: `${HarvestDouble.ROOT}/.worktrees/7`, branch: 'feat/7',
      }),
    }))

    expect(harvest.asked[0].issueNumber).toBe(7)
  })

  it('the_root_the_workspace_was_cut_from_is_the_one_the_plugin_is_told_to_run_in_so_two_clones_never_mix', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested(new PreparedWorkspace({
      issueNumber: 7,
      located: new WorkspaceLocation({ root: '/elsewhere/clone', path: '/elsewhere/clone/.worktrees/7', branch: 'feat/7' }),
    }))

    expect(harvest.asked[0].root).toBe('/elsewhere/clone')
  })

  it('a_harvest_that_could_not_be_read_travels_out_typed_instead_of_becoming_an_outcome', async () => {
    const refusal = await HarvestDouble.unable('dispatch-check could not reach gh').refusal()

    expect(refusal).toBeInstanceOf(HarvestNotRead)
    expect(refusal.message).toBe('dispatch-check could not reach gh')
  })

  it('a_collected_slice_is_recorded_as_harvested_under_the_issue_and_repository_the_plugin_collected', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.COLLECTED)

    await harvest.harvested()

    expect(harvest.records.harvests).toEqual([
      { issue: 42, repository: HarvestDouble.REPOSITORY, located: HarvestDouble.PREPARED.located },
    ])
  })

  it.each<HarvestOutcomeValue>([HarvestOutcome.WAITING, HarvestOutcome.KEPT, HarvestOutcome.PARTIAL, HarvestOutcome.NOTHING_LEFT])(
    'a_slice_the_plugin_answered_%s_for_is_not_recorded_as_harvested_because_its_worktree_may_still_stand',
    async (outcome) => {
      const harvest = HarvestDouble.answering(outcome)

      await harvest.harvested()

      expect(harvest.records.harvests).toEqual([])
    },
  )

  it('a_harvest_that_could_not_be_read_records_nothing', async () => {
    const harvest = HarvestDouble.unable('dispatch-check could not reach gh')

    await harvest.refusal()

    expect(harvest.records.harvests).toEqual([])
  })

  it('a_collected_slice_whose_harvest_could_not_be_recorded_travels_out_typed', async () => {
    const refusal = await HarvestDouble.collectedButNotRecorded('harness/x/harvest.json could not be written').refusal()

    expect(refusal).toBeInstanceOf(HarvestNotRecorded)
    expect(refusal.message).toBe('harness/x/harvest.json could not be written')
  })
})
