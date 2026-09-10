import { HarvestOutcome } from '../domain/value-objects/harvest-outcome.ts'
import { Projection } from './projection.ts'
import { HarvestNotRead, HarvestNotUnderstood, PlanFailure } from '../domain/exceptions.ts'
import type { HarvestFailure } from '../domain/exceptions.ts'
import type { HarvestOutcomeValue } from '../domain/value-objects/harvest-outcome.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { PreparedWorkspace } from '../domain/value-objects/prepared-workspace.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { WorkspaceSurvey } from '../domain/value-objects/workspace-survey.ts'

export type HarvestFailureKind = new (message: string) => HarvestFailure

export type CheckoutsKnown = () => readonly CheckoutRoot[] | null

export type CheckoutSurveyed = (root: CheckoutRoot) => Promise<{ readonly survey: WorkspaceSurvey }>

export type WorkspaceHarvested = (
  prepared: PreparedWorkspace,
  repository: RepositoryName
) => Promise<{ readonly outcome: HarvestOutcomeValue }>

export type SweepWait = () => Promise<void>

export class SweepLine {
  static readonly SILENT = null

  static #BY_OUTCOME = new Projection<(prepared: PreparedWorkspace) => string | null, HarvestOutcomeValue>('harvest outcome sweep line', [
    [HarvestOutcome.WAITING, () => SweepLine.SILENT],
    [HarvestOutcome.COLLECTED, (prepared: PreparedWorkspace) => `harvest #${prepared.issueNumber}: collected\n`],
    [HarvestOutcome.KEPT, (prepared: PreparedWorkspace) =>
      `harvest #${prepared.issueNumber}: kept, the plugin refused to delete because the disk disagrees with the merged pull request; look at ${prepared.located.path}\n`],
    [HarvestOutcome.PARTIAL, (prepared: PreparedWorkspace) =>
      `harvest #${prepared.issueNumber}: PARTIAL, something was deleted and a later step failed; run dispatch-check ${prepared.issueNumber} --collect by hand to see what is pending\n`],
  ])

  static #BY_FAILURE = new Projection<(prepared: PreparedWorkspace, failure: HarvestFailure) => string, HarvestFailureKind>('harvest failure sweep line', [
    [HarvestNotRead, (prepared: PreparedWorkspace, failure: HarvestFailure) =>
      `harvest #${prepared.issueNumber}: nothing was touched, the next sweep retries: ${failure.message}\n`],
    [HarvestNotUnderstood, (prepared: PreparedWorkspace, failure: HarvestFailure) =>
      `harvest #${prepared.issueNumber}: FAILED and retrying will not fix it: ${failure.message}\n`],
  ])

  static declaredOutcomes(): HarvestOutcomeValue[] {
    return SweepLine.#BY_OUTCOME.members()
  }

  static declaredFailures(): HarvestFailureKind[] {
    return SweepLine.#BY_FAILURE.members()
  }

  static of(outcome: HarvestOutcomeValue, prepared: PreparedWorkspace): string | null {
    return SweepLine.#BY_OUTCOME.of(outcome)(prepared)
  }

  static forHarvest(prepared: PreparedWorkspace, failure: PlanFailure): string {
    return SweepLine.#BY_FAILURE.of(failure.constructor)(prepared, failure)
  }

  static forSurvey(failure: PlanFailure): string {
    return `harvest sweep: could not survey the checkout: ${failure.message}\n`
  }

  static forAnUnreadableRegistry(): string {
    return 'harvest sweep: the registry of checkouts cannot be read, so this sweep surveys none of them\n'
  }
}

export class HarvestClock {
  readonly checkouts: CheckoutsKnown
  readonly survey: CheckoutSurveyed
  readonly harvest: WorkspaceHarvested
  readonly sleep: SweepWait
  readonly stderr: (line: string) => void

  constructor({ checkouts, survey, harvest, sleep, stderr }: {
    checkouts: CheckoutsKnown,
    survey: CheckoutSurveyed,
    harvest: WorkspaceHarvested,
    sleep: SweepWait,
    stderr: (line: string) => void,
  }) {
    this.checkouts = checkouts
    this.survey = survey
    this.harvest = harvest
    this.sleep = sleep
    this.stderr = stderr
  }

  async start(): Promise<void> {
    for (;;) {
      await this.sweep()
      await this.sleep()
    }
  }

  async sweep(): Promise<void> {
    const roots = this.checkouts()
    if (roots === null) {
      this.stderr(SweepLine.forAnUnreadableRegistry())

      return
    }
    for (const root of roots) {
      await this.#sweepCheckout(root)
    }
  }

  async #sweepCheckout(root: CheckoutRoot): Promise<void> {
    let checkout: WorkspaceSurvey
    try {
      checkout = (await this.survey(root)).survey
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(SweepLine.forSurvey(failure))
      return
    }
    for (const prepared of checkout.prepared) {
      await this.#collect(prepared, checkout.repository)
    }
  }

  #say(line: string | null): void {
    if (line === SweepLine.SILENT) return
    this.stderr(line)
  }

  async #collect(prepared: PreparedWorkspace, repository: RepositoryName): Promise<void> {
    let collected: { readonly outcome: HarvestOutcomeValue }
    try {
      collected = await this.harvest(prepared, repository)
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.#say(SweepLine.forHarvest(prepared, failure))
      return
    }
    this.#say(SweepLine.of(collected.outcome, prepared))
  }
}
