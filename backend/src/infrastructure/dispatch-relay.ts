import { Reservation, WorkInFlight } from './work-in-flight.ts'
import { DispatchNotAvailable, PlanFailure } from '../domain/exceptions.ts'
import type { PlanStarted, SliceNotStarted, StartMilestonePlanResult } from '../application/actions/start-milestone-plan.ts'
import { EpicSpec } from '../domain/value-objects/epic-spec.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export type EpicSpecRead = (root: CheckoutRoot) => Promise<EpicSpec | null>

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
}

export class DispatchRelay {
  static readonly OWN_KEY_PREFIX = 'relay:'

  readonly spec: EpicSpecRead
  readonly dispatch: MilestoneDispatched
  readonly inFlight: WorkInFlight
  readonly stderr: (line: string) => void

  constructor({ spec, dispatch, inFlight, stderr }: {
    spec: EpicSpecRead,
    dispatch: MilestoneDispatched,
    inFlight: WorkInFlight,
    stderr: (line: string) => void,
  }) {
    this.spec = spec
    this.dispatch = dispatch
    this.inFlight = inFlight
    this.stderr = stderr
  }

  async relay(root: CheckoutRoot, repository: RepositoryName): Promise<void> {
    let found: EpicSpec | null
    try {
      found = await this.spec(root)
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(RelayLine.refused(repository, failure))

      return
    }
    const milestone = DispatchRelay.#milestoneOf(found)
    if (milestone === null) return

    if (this.inFlight.holds(repository.text)) return

    const own = DispatchRelay.ownKeyFor(repository)
    if (this.inFlight.reserve(own) === Reservation.IN_PROGRESS) return
    try {
      const dispatched = await this.dispatch({ repository, root, milestone })
      for (const started of dispatched.started) this.stderr(RelayLine.dispatched(started))
      for (const slice of dispatched.failed) this.stderr(RelayLine.notStarted(slice))
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      if (failure instanceof DispatchNotAvailable) return
      this.stderr(RelayLine.refused(repository, failure))
    } finally {
      this.inFlight.release(own)
    }
  }

  static ownKeyFor(repository: RepositoryName): string {
    return `${DispatchRelay.OWN_KEY_PREFIX}${repository.text}`
  }

  static #milestoneOf(spec: EpicSpec | null): string | null {
    if (spec === null || !spec.isFrozen()) return null

    return spec.title()
  }
}
