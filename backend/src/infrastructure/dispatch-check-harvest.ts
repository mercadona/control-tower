import { Harvest } from '../domain/ports/harvest.ts'
import { HarvestOutcome } from '../domain/value-objects/harvest-outcome.ts'
import { HarvestNotRead, HarvestNotUnderstood } from '../domain/exceptions.ts'
import type { HarvestOutcomeValue } from '../domain/value-objects/harvest-outcome.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ProcessOutput, ToolRunner } from './tool-runner.ts'

type HarvestProjection = (said: ProcessOutput, issueNumber: number) => HarvestOutcomeValue

export class DispatchCheckHarvest extends Harvest {
  static readonly COMMAND = 'dispatch-check --collect'
  static readonly COLLECTED = 0
  static readonly WAITING = 1
  static readonly USAGE_REFUSED = 2
  static readonly NOT_READ = 3
  static readonly PARTIAL = 4
  static readonly KEPT = 10
  static readonly LEDGER_REFUSED = 11

  static readonly #BY_CODE = Object.freeze<Record<number, HarvestProjection | undefined>>({
    [DispatchCheckHarvest.COLLECTED]: () => HarvestOutcome.COLLECTED,
    [DispatchCheckHarvest.WAITING]: (said, issueNumber) => DispatchCheckHarvest.#waiting(said, issueNumber),
    [DispatchCheckHarvest.USAGE_REFUSED]: (said, issueNumber) => {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} refused the invocation it was given for #${issueNumber}, so this is configuration and retrying changes nothing: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckHarvest.NOT_READ]: (said, issueNumber) => {
      throw new HarvestNotRead(
        `${DispatchCheckHarvest.COMMAND} could not read what #${issueNumber} left behind and touched nothing, so the next sweep can try again: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckHarvest.PARTIAL]: () => HarvestOutcome.PARTIAL,
    [DispatchCheckHarvest.KEPT]: () => HarvestOutcome.KEPT,
    [DispatchCheckHarvest.LEDGER_REFUSED]: (said, issueNumber) => {
      throw new HarvestNotRead(
        `${DispatchCheckHarvest.COMMAND} could not load the harvest row of #${issueNumber} into the ledger, so the next sweep can try again: ${said.stderr.trim()}`
      )
    },
  })

  readonly node: ToolRunner['run']
  readonly dispatchCheck: string
  readonly harvestTable: string | null

  constructor({ node, dispatchCheck, harvestTable }: {
    node: ToolRunner['run'],
    dispatchCheck: string,
    harvestTable: string | null,
  }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
    this.harvestTable = harvestTable
  }

  static argvFor({ dispatchCheck, issueNumber, repository, harvestTable }: {
    dispatchCheck: string,
    issueNumber: number,
    repository: RepositoryName,
    harvestTable: string | null,
  }): string[] {
    const argv = [dispatchCheck, String(issueNumber), '--repo', repository.text, '--collect']
    return harvestTable === null ? argv : [...argv, '--bq', harvestTable]
  }

  static declaredCodes(): number[] {
    return Object.keys(DispatchCheckHarvest.#BY_CODE).map(Number)
  }

  async collect({ issueNumber, repository, root }: {
    issueNumber: number,
    repository: RepositoryName,
    root: string | undefined,
  }): Promise<HarvestOutcomeValue> {
    const said = await this.node(
      DispatchCheckHarvest.argvFor({
        dispatchCheck: this.dispatchCheck,
        issueNumber,
        repository,
        harvestTable: this.harvestTable,
      }),
      { cwd: root }
    )
    const projected = DispatchCheckHarvest.#BY_CODE[said.code]
    if (projected === undefined) {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} exited ${said.code} for #${issueNumber} and the harvest contract declares only ${DispatchCheckHarvest.declaredCodes().join(', ')}: ${DispatchCheckHarvest.#printed(said)}`
      )
    }

    return projected(said, issueNumber)
  }

  static #waiting(said: ProcessOutput, issueNumber: number): HarvestOutcomeValue {
    if (said.stdout.trim().length === 0) {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} exited ${DispatchCheckHarvest.WAITING} for #${issueNumber} without saying what it waits for, so it broke instead of waiting: ${DispatchCheckHarvest.#printed(said)}`
      )
    }

    return HarvestOutcome.WAITING
  }

  static #printed(said: ProcessOutput): string {
    return `stdout ${JSON.stringify(said.stdout.trim())}, stderr ${JSON.stringify(said.stderr.trim())}`
  }
}
