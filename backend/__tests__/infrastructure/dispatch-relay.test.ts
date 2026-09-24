import { describe, it, expect } from 'vitest'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { DispatchRelay, RelayLine } from '../../src/infrastructure/dispatch-relay.ts'
import { WorkInFlight, Reservation } from '../../src/infrastructure/work-in-flight.ts'
import { PlanStarted } from '../../src/application/actions/start-milestone-plan.ts'
import {
  SliceNotStarted, StartMilestonePlanResult,
} from '../../src/application/actions/start-milestone-plan.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import {
  DispatchNotAvailable, DispatchNotRead, EpicSpecNotRead, EpicSpecNotUnderstood, PlanAgentNotLaunched,
} from '../../src/domain/exceptions.ts'
import type { PlanFailure } from '../../src/domain/exceptions.ts'

type DispatchAsked = { repository: RepositoryName, root: CheckoutRoot, milestone: string }

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static readonly MILESTONE = 'The chain that does not stop'
  static readonly SPEC_PATH = 'docs/superpowers/specs/2026-09-18-the-chain-that-does-not-stop-execution.md'

  static frozenSpec(): EpicSpec {
    return new EpicSpec({
      path: Mother.SPEC_PATH,
      text: `# ${Mother.MILESTONE}${EpicSpec.TITLE_SUFFIX}\n${EpicSpec.STATE_LINE} ${EpicSpec.FROZEN}\n`,
    })
  }

  static draftSpec(): EpicSpec {
    return new EpicSpec({
      path: Mother.SPEC_PATH,
      text: `# ${Mother.MILESTONE}${EpicSpec.TITLE_SUFFIX}\n${EpicSpec.STATE_LINE} ${EpicSpec.DRAFT}\n`,
    })
  }

  static titlelessFrozenSpec(): EpicSpec {
    return new EpicSpec({
      path: Mother.SPEC_PATH,
      text: `${EpicSpec.STATE_LINE} ${EpicSpec.FROZEN}\n`,
    })
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
  readonly specAnswer: EpicSpec | null | Error
  readonly dispatchAnswer: StartMilestonePlanResult | Error
  readonly dispatchAsked: DispatchAsked[]
  readonly written: string[]
  readonly inFlight: WorkInFlight
  readonly during: (inFlight: WorkInFlight) => void

  constructor({ spec, dispatch = Mother.dispatching(Mother.started()), inFlight = new WorkInFlight(), during = () => {} }: {
    spec: EpicSpec | null | Error,
    dispatch?: StartMilestonePlanResult | Error,
    inFlight?: WorkInFlight,
    during?: (inFlight: WorkInFlight) => void,
  }) {
    this.during = during
    this.specAnswer = spec
    this.dispatchAnswer = dispatch
    this.dispatchAsked = []
    this.written = []
    this.inFlight = inFlight
  }

  async run(): Promise<Relaying> {
    const relay = new DispatchRelay({
      spec: () => this.specAnswer instanceof Error
        ? Promise.reject(this.specAnswer)
        : Promise.resolve(this.specAnswer),
      dispatch: (asked) => {
        this.dispatchAsked.push(asked)
        this.during(this.inFlight)
        return this.dispatchAnswer instanceof Error
          ? Promise.reject(this.dispatchAnswer)
          : Promise.resolve(this.dispatchAnswer)
      },
      inFlight: this.inFlight,
      stderr: (line) => this.written.push(line),
    })
    await relay.relay(Mother.ROOT, Mother.REPOSITORY)

    return this
  }
}

describe('DispatchRelay', () => {
  it('the relay dispatches the milestone of the frozen spec and names no issue', async () => {
    const relaying = await new Relaying({ spec: Mother.frozenSpec() }).run()

    expect(relaying.dispatchAsked).toEqual([
      { repository: Mother.REPOSITORY, root: Mother.ROOT, milestone: Mother.MILESTONE },
    ])
    expect(relaying.written).toEqual([RelayLine.dispatched(Mother.started())])
  })

  it('a spec that cannot be read is reported and never escapes the relay, so the clock keeps sweeping', async () => {
    const unreadable = new EpicSpecNotRead('docs/superpowers/specs/x-execution.md was listed but could not be read')

    const relaying = await new Relaying({ spec: unreadable }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([RelayLine.refused(Mother.REPOSITORY, unreadable)])
  })

  it('a spec still being drafted, with no title yet, is reported and never escapes the relay', async () => {
    const untitled = new EpicSpecNotUnderstood('docs/superpowers/specs/x-execution.md carries no title')

    const relaying = await new Relaying({ spec: untitled }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([RelayLine.refused(Mother.REPOSITORY, untitled)])
  })

  it('a failure that is not a plan failure still escapes, because it is a fault and not a checkout', async () => {
    const bug = new TypeError('a programming error, not a spec')

    await expect(new Relaying({ spec: bug }).run()).rejects.toThrow(bug)
  })

  it('a draft spec, a null spec and a titleless spec all dispatch nothing', async () => {
    const draft = await new Relaying({ spec: Mother.draftSpec() }).run()
    const missing = await new Relaying({ spec: null }).run()
    const titleless = await new Relaying({ spec: Mother.titlelessFrozenSpec() }).run()

    for (const relaying of [draft, missing, titleless]) {
      expect(relaying.dispatchAsked).toEqual([])
      expect(relaying.written).toEqual([])
    }
  })

  it('nothing admissible stays silent while a read failure writes one line', async () => {
    const full = await new Relaying({
      spec: Mother.frozenSpec(),
      dispatch: new DispatchNotAvailable('the plugin did not select a slice'),
    }).run()
    const readFailure = await new Relaying({
      spec: Mother.frozenSpec(),
      dispatch: new DispatchNotRead('gh could not read the complete issue table'),
    }).run()

    expect(full.written).toEqual([])
    expect(readFailure.written).toEqual([
      RelayLine.refused(Mother.REPOSITORY, new DispatchNotRead('gh could not read the complete issue table')),
    ])
  })

  it('the clock never refuses the cabin: a request can reserve the repository while the relay is dispatching', async () => {
    let reservedMidDispatch: string | null = null

    await new Relaying({
      spec: Mother.frozenSpec(),
      during: (inFlight) => { reservedMidDispatch = inFlight.reserve(Mother.REPOSITORY.text) },
    }).run()

    expect(reservedMidDispatch).toBe(Reservation.RESERVED)
  })

  it('two relays of the same repository still exclude each other', async () => {
    const inFlight = new WorkInFlight()
    inFlight.reserve(DispatchRelay.ownKeyFor(Mother.REPOSITORY))

    const relaying = await new Relaying({ spec: Mother.frozenSpec(), inFlight }).run()

    expect(relaying.dispatchAsked).toEqual([])
  })

  it('a reservation another start holds stops the relay and survives it', async () => {
    const inFlight = new WorkInFlight()
    inFlight.reserve(Mother.REPOSITORY.text)
    const relaying = await new Relaying({ spec: Mother.frozenSpec(), inFlight }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([])
    expect(inFlight.reserve(Mother.REPOSITORY.text)).toBe(Reservation.IN_PROGRESS)
  })

  it('one line per dispatch of the batch, each naming its own issue', async () => {
    const relaying = await new Relaying({
      spec: Mother.frozenSpec(),
      dispatch: Mother.dispatching(Mother.started(12), Mother.started(13), Mother.started(14)),
    }).run()

    expect(relaying.written).toEqual([
      'relay: dispatched josemerca/ct-loop-sandbox#12 as workspace:12\n',
      'relay: dispatched josemerca/ct-loop-sandbox#13 as workspace:13\n',
      'relay: dispatched josemerca/ct-loop-sandbox#14 as workspace:14\n',
    ])
  })

  it('a slice that failed to start is reported with its issue and the rest keep their line', async () => {
    const relaying = await new Relaying({
      spec: Mother.frozenSpec(),
      dispatch: new StartMilestonePlanResult({
        started: [Mother.started(12), Mother.started(14)],
        failed: [Mother.notStarted(13, new PlanAgentNotLaunched('worker acceptance was lost'))],
      }),
    }).run()

    expect(relaying.written).toEqual([
      'relay: dispatched josemerca/ct-loop-sandbox#12 as workspace:12\n',
      'relay: dispatched josemerca/ct-loop-sandbox#14 as workspace:14\n',
      'relay: josemerca/ct-loop-sandbox#13 could not be dispatched: worker acceptance was lost\n',
    ])
  })

  it('the reservation goes back after a failed dispatch', async () => {
    const inFlight = new WorkInFlight()
    await new Relaying({
      spec: Mother.frozenSpec(),
      dispatch: new DispatchNotRead('gh could not read the complete issue table'),
      inFlight,
    }).run()

    expect(inFlight.reserve(Mother.REPOSITORY.text)).toBe(Reservation.RESERVED)
  })
})
