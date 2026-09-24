import { describe, it, expect } from 'vitest'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { DispatchRelay, RelayLine } from '../../src/infrastructure/dispatch-relay.ts'
import { WorkInFlight, Reservation } from '../../src/infrastructure/work-in-flight.ts'
import { PlanStarted } from '../../src/application/actions/start-milestone-plan.ts'
import {
  SliceNotStarted, StartMilestonePlanResult,
} from '../../src/application/actions/start-milestone-plan.ts'
import { AuthorisedMilestones } from '../../src/domain/value-objects/authorised-milestones.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import {
  DispatchNotAvailable, DispatchNotRead, PlanAgentNotLaunched,
} from '../../src/domain/exceptions.ts'
import type { PlanFailure } from '../../src/domain/exceptions.ts'

type DispatchAsked = { repository: RepositoryName, root: CheckoutRoot, milestone: string }
type DispatchAnswer = StartMilestonePlanResult | Error

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly MILESTONE = 'The chain that does not stop'

  static readonly OTHER_MILESTONE = 'The groom is an interactive session'

  static authorised(...titles: string[]): AuthorisedMilestones {
    return AuthorisedMilestones.of(titles.map((milestone) => ({ milestone, status: PlanIssueStatus.READY })))
  }

  static started(issue = 12): PlanStarted {
    return new PlanStarted({
      agent: `workspace:${issue}`,
      baseline: BaselineResult.notMeasured('no test command declared'),
      watch: new PlanWatch({
        story: null,
        issue: Mother.issue(issue),
        located: new WorkspaceLocation({
          root: Mother.ROOT.text, path: `${Mother.ROOT.text}/.worktrees/${issue}`, branch: `feat/${issue}`,
        }),
        repository: Mother.REPOSITORY,
        agent: `workspace:${issue}`,
      }),
    })
  }

  static issue(number: number): PlanIssue {
    return new PlanIssue({ number, url: `https://github.com/josemerca/ct-loop-sandbox/issues/${number}` })
  }

  static notStarted(number: number, cause: PlanFailure): SliceNotStarted {
    return new SliceNotStarted({ issue: Mother.issue(number), repository: Mother.REPOSITORY, cause })
  }

  static dispatching(...started: PlanStarted[]): StartMilestonePlanResult {
    return new StartMilestonePlanResult({ started, failed: [] })
  }
}

class Relaying {
  readonly milestonesAnswer: AuthorisedMilestones | Error
  readonly answers: ReadonlyMap<string, DispatchAnswer>
  readonly dispatchAsked: DispatchAsked[]
  readonly written: string[]
  readonly inFlight: WorkInFlight
  readonly during: (inFlight: WorkInFlight) => void

  constructor({
    milestones = Mother.authorised(Mother.MILESTONE),
    answers = new Map([[Mother.MILESTONE, Mother.dispatching(Mother.started())]]),
    inFlight = new WorkInFlight(),
    during = () => {},
  }: {
    milestones?: AuthorisedMilestones | Error,
    answers?: ReadonlyMap<string, DispatchAnswer>,
    inFlight?: WorkInFlight,
    during?: (inFlight: WorkInFlight) => void,
  } = {}) {
    this.milestonesAnswer = milestones
    this.answers = answers
    this.during = during
    this.dispatchAsked = []
    this.written = []
    this.inFlight = inFlight
  }

  static answering(milestone: string, answer: DispatchAnswer): Relaying {
    return new Relaying({ answers: new Map([[milestone, answer]]) })
  }

  async run(): Promise<Relaying> {
    const relay = new DispatchRelay({
      milestones: () => this.milestonesAnswer instanceof Error
        ? Promise.reject(this.milestonesAnswer)
        : Promise.resolve(this.milestonesAnswer),
      dispatch: (asked) => {
        this.dispatchAsked.push(asked)
        this.during(this.inFlight)
        const answer = this.answers.get(asked.milestone)
        if (answer === undefined) return Promise.reject(new Error(`unexpected dispatch of ${asked.milestone}`))
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
      },
      inFlight: this.inFlight,
      stderr: (line) => this.written.push(line),
    })
    await relay.relay(Mother.ROOT, Mother.REPOSITORY)

    return this
  }
}

describe('DispatchRelay', () => {
  it('the relay dispatches the authorised milestone and names no issue', async () => {
    const relaying = await new Relaying().run()

    expect(relaying.dispatchAsked).toEqual([
      { repository: Mother.REPOSITORY, root: Mother.ROOT, milestone: Mother.MILESTONE },
    ])
    expect(relaying.written).toEqual([RelayLine.dispatched(Mother.started())])
  })

  it('every authorised milestone is dispatched in the same sweep, one dispatch each', async () => {
    const relaying = await new Relaying({
      milestones: Mother.authorised(Mother.MILESTONE, Mother.OTHER_MILESTONE),
      answers: new Map([
        [Mother.MILESTONE, Mother.dispatching(Mother.started(12))],
        [Mother.OTHER_MILESTONE, Mother.dispatching(Mother.started(20))],
      ]),
    }).run()

    expect(relaying.dispatchAsked.map((asked) => asked.milestone)).toEqual([Mother.MILESTONE, Mother.OTHER_MILESTONE])
    expect(relaying.written).toEqual([RelayLine.dispatched(Mother.started(12)), RelayLine.dispatched(Mother.started(20))])
  })

  it('a milestone whose dispatch fails is named and the next milestone still goes', async () => {
    const unread = new DispatchNotRead('gh could not read the complete issue table')

    const relaying = await new Relaying({
      milestones: Mother.authorised(Mother.OTHER_MILESTONE, Mother.MILESTONE),
      answers: new Map<string, DispatchAnswer>([
        [Mother.MILESTONE, unread],
        [Mother.OTHER_MILESTONE, Mother.dispatching(Mother.started(20))],
      ]),
    }).run()

    expect(relaying.dispatchAsked.map((asked) => asked.milestone)).toEqual([Mother.MILESTONE, Mother.OTHER_MILESTONE])
    expect(relaying.written).toEqual([
      RelayLine.refusedIn(Mother.REPOSITORY, Mother.MILESTONE, unread),
      RelayLine.dispatched(Mother.started(20)),
    ])
  })

  it('a start the cabin reserves during the sweep stops the milestones still to go', async () => {
    const relaying = await new Relaying({
      milestones: Mother.authorised(Mother.MILESTONE, Mother.OTHER_MILESTONE),
      during: (inFlight) => { inFlight.reserve(Mother.REPOSITORY.text) },
    }).run()

    expect(relaying.dispatchAsked.map((asked) => asked.milestone)).toEqual([Mother.MILESTONE])
  })

  it('the milestones that cannot be read are reported and never escape the relay, so the clock keeps sweeping', async () => {
    const unread = new DispatchNotRead('gh could not read the open issue table')

    const relaying = await new Relaying({ milestones: unread }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([RelayLine.refused(Mother.REPOSITORY, unread)])
  })

  it('a failure that is not a plan failure still escapes, because it is a fault and not a checkout', async () => {
    const bug = new TypeError('a programming error, not a table')

    await expect(new Relaying({ milestones: bug }).run()).rejects.toThrow(bug)
  })

  it('a repository with no authorised milestone dispatches nothing and writes nothing', async () => {
    const relaying = await new Relaying({ milestones: Mother.authorised() }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([])
  })

  it('nothing admissible stays silent while a read failure writes one line naming its milestone', async () => {
    const full = await Relaying.answering(Mother.MILESTONE, new DispatchNotAvailable('the plugin did not select a slice')).run()
    const unread = new DispatchNotRead('gh could not read the complete issue table')
    const readFailure = await Relaying.answering(Mother.MILESTONE, unread).run()

    expect(full.written).toEqual([])
    expect(readFailure.written).toEqual([RelayLine.refusedIn(Mother.REPOSITORY, Mother.MILESTONE, unread)])
  })

  it('the clock never refuses the cabin: a request can reserve the repository while the relay is dispatching', async () => {
    let reservedMidDispatch: string | null = null

    await new Relaying({
      during: (inFlight) => { reservedMidDispatch = inFlight.reserve(Mother.REPOSITORY.text) },
    }).run()

    expect(reservedMidDispatch).toBe(Reservation.RESERVED)
  })

  it('two relays of the same repository still exclude each other', async () => {
    const inFlight = new WorkInFlight()
    inFlight.reserve(DispatchRelay.ownKeyFor(Mother.REPOSITORY))

    const relaying = await new Relaying({ inFlight }).run()

    expect(relaying.dispatchAsked).toEqual([])
  })

  it('a reservation another start holds stops the relay and survives it', async () => {
    const inFlight = new WorkInFlight()
    inFlight.reserve(Mother.REPOSITORY.text)
    const relaying = await new Relaying({ inFlight }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([])
    expect(inFlight.reserve(Mother.REPOSITORY.text)).toBe(Reservation.IN_PROGRESS)
  })

  it('one line per dispatch of the batch, each naming its own issue', async () => {
    const relaying = await Relaying.answering(
      Mother.MILESTONE, Mother.dispatching(Mother.started(12), Mother.started(13), Mother.started(14)),
    ).run()

    expect(relaying.written).toEqual([
      'relay: dispatched josemerca/ct-loop-sandbox#12 as workspace:12\n',
      'relay: dispatched josemerca/ct-loop-sandbox#13 as workspace:13\n',
      'relay: dispatched josemerca/ct-loop-sandbox#14 as workspace:14\n',
    ])
  })

  it('a slice that failed to start is reported with its issue and the rest keep their line', async () => {
    const relaying = await Relaying.answering(Mother.MILESTONE, new StartMilestonePlanResult({
      started: [Mother.started(12), Mother.started(14)],
      failed: [Mother.notStarted(13, new PlanAgentNotLaunched('worker acceptance was lost'))],
    })).run()

    expect(relaying.written).toEqual([
      'relay: dispatched josemerca/ct-loop-sandbox#12 as workspace:12\n',
      'relay: dispatched josemerca/ct-loop-sandbox#14 as workspace:14\n',
      'relay: josemerca/ct-loop-sandbox#13 could not be dispatched: worker acceptance was lost\n',
    ])
  })

  it('the relay gives its reservation back once every milestone was tried, even after a failed one', async () => {
    const inFlight = new WorkInFlight()
    await new Relaying({
      milestones: Mother.authorised(Mother.MILESTONE, Mother.OTHER_MILESTONE),
      answers: new Map<string, DispatchAnswer>([
        [Mother.MILESTONE, new DispatchNotRead('gh could not read the complete issue table')],
        [Mother.OTHER_MILESTONE, Mother.dispatching(Mother.started(20))],
      ]),
      inFlight,
    }).run()

    expect(inFlight.reserve(DispatchRelay.ownKeyFor(Mother.REPOSITORY))).toBe(Reservation.RESERVED)
    expect(inFlight.reserve(Mother.REPOSITORY.text)).toBe(Reservation.RESERVED)
  })
})
