import { Reservation, WorkInFlight } from './work-in-flight.ts'
import { DispatchNotAvailable, PlanFailure } from '../domain/exceptions.ts'
import type { PlanStarted, SliceNotStarted, StartMilestonePlanResult } from '../application/actions/start-milestone-plan.ts'
import type { AuthorisedMilestones } from '../domain/value-objects/authorised-milestones.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export type AuthorisedMilestonesRead = (repository: RepositoryName) => Promise<AuthorisedMilestones>

export type OwnMilestoneRead = (asked: { root: CheckoutRoot, repository: RepositoryName }) => Promise<string | null>

export type MilestoneDispatched = (asked: {
  repository: RepositoryName, root: CheckoutRoot, milestone: string,
}) => Promise<StartMilestonePlanResult>

export class RelayLine {
  static readonly SILENT = null

  static dispatched(started: PlanStarted): string {
    return `relay: dispatched ${started.watch.repository.text}#${started.watch.issue.number} as ${started.agent}\n`
  }

  static notStarted(slice: SliceNotStarted): string {
    return `relay: ${slice.repository.text}#${slice.issue.number} could not be dispatched: ${slice.cause.message}\n`
  }

  static refused(repository: RepositoryName, failure: PlanFailure): string {
    return `relay: ${repository.text} could not be dispatched: ${failure.message}\n`
  }

  static refusedIn(repository: RepositoryName, milestone: string, failure: PlanFailure): string {
    return `relay: ${repository.text} milestone "${milestone}" could not be dispatched: ${failure.message}\n`
  }
}

export class DispatchRelay {
  static readonly OWN_KEY_PREFIX = 'relay:'

  readonly milestones: AuthorisedMilestonesRead
  readonly ownMilestone: OwnMilestoneRead
  readonly dispatch: MilestoneDispatched
  readonly inFlight: WorkInFlight
  readonly stderr: (line: string) => void

  constructor({ milestones, ownMilestone, dispatch, inFlight, stderr }: {
    milestones: AuthorisedMilestonesRead,
    ownMilestone: OwnMilestoneRead,
    dispatch: MilestoneDispatched,
    inFlight: WorkInFlight,
    stderr: (line: string) => void,
  }) {
    this.milestones = milestones
    this.ownMilestone = ownMilestone
    this.dispatch = dispatch
    this.inFlight = inFlight
    this.stderr = stderr
  }

  async relay(root: CheckoutRoot, repository: RepositoryName): Promise<void> {
    let milestone: string | null
    let authorised: AuthorisedMilestones
    try {
      milestone = await this.ownMilestone({ root, repository })
      if (milestone === null) return
      authorised = await this.milestones(repository)
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(RelayLine.refused(repository, failure))

      return
    }
    if (!authorised.titles.includes(milestone)) return
    if (this.inFlight.holds(repository.text)) return

    const own = DispatchRelay.ownKeyFor(repository)
    if (this.inFlight.reserve(own) === Reservation.IN_PROGRESS) return
    try {
      await this.#dispatchMilestone(root, repository, milestone)
    } finally {
      this.inFlight.release(own)
    }
  }

  async #dispatchMilestone(root: CheckoutRoot, repository: RepositoryName, milestone: string): Promise<void> {
    try {
      const dispatched = await this.dispatch({ repository, root, milestone })
      for (const started of dispatched.started) this.stderr(RelayLine.dispatched(started))
      for (const slice of dispatched.failed) this.stderr(RelayLine.notStarted(slice))
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      if (failure instanceof DispatchNotAvailable) return
      this.stderr(RelayLine.refusedIn(repository, milestone, failure))
    }
  }

  static ownKeyFor(repository: RepositoryName): string {
    return `${DispatchRelay.OWN_KEY_PREFIX}${repository.text}`
  }
}
