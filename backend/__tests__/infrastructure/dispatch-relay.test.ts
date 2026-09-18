import { describe, it, expect } from 'vitest'
import { BaselineResult } from '../../../plugin/scripts/baseline.js'
import { DispatchRelay, RelayLine } from '../../src/infrastructure/dispatch-relay.ts'
import { WorkInFlight, Reservation } from '../../src/infrastructure/work-in-flight.ts'
import { PlanStarted } from '../../src/application/actions/start-plan.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { DispatchNotAvailable, DispatchNotRead } from '../../src/domain/exceptions.ts'

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

  static started(): PlanStarted {
    return new PlanStarted({
      agent: 'workspace:9',
      baseline: BaselineResult.notMeasured('no test command declared'),
      watch: new PlanWatch({
        story: null,
        issue: new PlanIssue({ number: 12, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/12' }),
        located: new WorkspaceLocation({
          root: Mother.ROOT.text, path: `${Mother.ROOT.text}/.worktrees/12`, branch: 'feat/12',
        }),
        repository: Mother.REPOSITORY,
        agent: 'workspace:9',
      }),
    })
  }
}

class Relaying {
  readonly specAnswer: EpicSpec | null
  readonly dispatchAnswer: PlanStarted | Error
  readonly dispatchAsked: DispatchAsked[]
  readonly written: string[]
  readonly inFlight: WorkInFlight

  constructor({ spec, dispatch = Mother.started(), inFlight = new WorkInFlight() }: {
    spec: EpicSpec | null,
    dispatch?: PlanStarted | Error,
    inFlight?: WorkInFlight,
  }) {
    this.specAnswer = spec
    this.dispatchAnswer = dispatch
    this.dispatchAsked = []
    this.written = []
    this.inFlight = inFlight
  }

  async run(): Promise<Relaying> {
    const relay = new DispatchRelay({
      spec: () => Promise.resolve(this.specAnswer),
      dispatch: (asked) => {
        this.dispatchAsked.push(asked)
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

  it('a draft spec, a null spec and a titleless spec all dispatch nothing', async () => {
    const draft = await new Relaying({ spec: Mother.draftSpec() }).run()
    const missing = await new Relaying({ spec: null }).run()
    const titleless = await new Relaying({ spec: Mother.titlelessFrozenSpec() }).run()

    for (const relaying of [draft, missing, titleless]) {
      expect(relaying.dispatchAsked).toEqual([])
      expect(relaying.written).toEqual([])
    }
  })

  it('a full cap stays silent while a read failure writes one line', async () => {
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

  it('a reservation another start holds stops the relay and survives it', async () => {
    const inFlight = new WorkInFlight()
    inFlight.reserve(Mother.REPOSITORY.text)
    const relaying = await new Relaying({ spec: Mother.frozenSpec(), inFlight }).run()

    expect(relaying.dispatchAsked).toEqual([])
    expect(relaying.written).toEqual([])
    expect(inFlight.reserve(Mother.REPOSITORY.text)).toBe(Reservation.IN_PROGRESS)
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
