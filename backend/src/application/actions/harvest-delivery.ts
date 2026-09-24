import type { Harvest } from '../../domain/ports/harvest.ts'
import type { PlanRecords } from '../../domain/ports/plan-records.ts'
import { HarvestOutcome } from '../../domain/value-objects/harvest-outcome.ts'
import type { HarvestOutcomeValue } from '../../domain/value-objects/harvest-outcome.ts'
import type { PreparedWorkspace } from '../../domain/value-objects/prepared-workspace.ts'
import type { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export class HarvestDeliveryParams {
  readonly prepared: PreparedWorkspace
  readonly repository: RepositoryName

  constructor({ prepared, repository }: { prepared: PreparedWorkspace, repository: RepositoryName }) {
    this.prepared = prepared
    this.repository = repository
    Object.freeze(this)
  }
}

export class HarvestDeliveryResult {
  readonly outcome: HarvestOutcomeValue

  constructor({ outcome }: { outcome: HarvestOutcomeValue }) {
    this.outcome = outcome
    Object.freeze(this)
  }
}

export class HarvestDelivery {
  readonly harvest: Harvest
  readonly records: PlanRecords

  constructor({ harvest, records }: { harvest: Harvest, records: PlanRecords }) {
    this.harvest = harvest
    this.records = records
  }

  async execute(params: HarvestDeliveryParams): Promise<HarvestDeliveryResult> {
    const outcome = await this.harvest.collect({
      issueNumber: params.prepared.issueNumber,
      repository: params.repository,
      root: params.prepared.located.root,
    })
    if (outcome === HarvestOutcome.COLLECTED) {
      await this.records.recordHarvest({ issue: params.prepared.issueNumber, repository: params.repository })
    }
    return new HarvestDeliveryResult({ outcome })
  }
}
