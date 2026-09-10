import { describe, expect, it } from 'vitest'
import { Deferred, PlanWatchMother, RecoveryFixture } from '../fixtures/parallel-workflows.ts'
import { PlansInFlight } from '../../src/domain/value-objects/plans-in-flight.ts'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.ts'

describe('Active plan refresh', () => {
  it('discovers another plan after the first successful recovery', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.watches.push(PlanWatchMother.of('owner/alpha', 8))

    expect(await fixture.refresh()).toBeNull()

    expect(fixture.activePlans.known().map((entry) => entry.plan.issue.number)).toEqual([7, 8])
    expect(fixture.reviews.startRecovered).toHaveBeenCalledTimes(2)
    expect(fixture.plans.inFlight.mock.calls[1]?.[0]).toEqual([fixture.watches[0]])
  })

  it('removes only a session whose absence was confirmed', async () => {
    const fixture = new RecoveryFixture()
    const first = fixture.watches[0]!
    fixture.watches.push(PlanWatchMother.of('owner/beta'))
    await fixture.recovery.recover()
    fixture.watches = [fixture.watches[1]!]

    await fixture.refresh()

    expect(fixture.activePlans.known().map((entry) => entry.plan.repo)).toEqual(['owner/beta'])
    expect(fixture.reviews.stop).toHaveBeenCalledExactlyOnceWith({ issue: 7, repository: first.repository })
    expect(fixture.pullRequestReviews.stop).toHaveBeenCalledExactlyOnceWith({ issue: 7, repository: first.repository })
  })

  it.each(['implementing', 'uncertain'])('removes a confirmed absent %s session', async (phase) => {
    const fixture = new RecoveryFixture()
    const first = fixture.watches[0]!
    if (phase === 'implementing') fixture.implementing.add(first.agent)
    else fixture.authorized.add(first.agent)
    await fixture.recovery.recover()
    fixture.watches = []

    await fixture.refresh()

    expect(fixture.activePlans.known()).toEqual([])
  })

  it('keeps known plans after an incomplete refresh and retries without caching the failure', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.plans.inFlight.mockResolvedValueOnce(PlansInFlight.incomplete([], 'one checkout could not be read'))

    expect(await fixture.refresh()).toBe('one checkout could not be read')
    expect(fixture.activePlans.known()).toHaveLength(1)
    expect(fixture.reviews.stop).not.toHaveBeenCalled()
    expect(await fixture.recovery.recover()).toBeNull()
    expect(fixture.plans.inFlight).toHaveBeenCalledTimes(3)
  })

  it('resolves an uncertain session when its run shows implementation underway', async () => {
    const fixture = new RecoveryFixture()
    fixture.authorized.add(fixture.watches[0]!.agent)
    await fixture.recovery.recover()
    expect(fixture.activePlans.known()[0]?.phase).toBe('uncertain')
    fixture.implementationProgress.of.mockResolvedValue(ImplementationState.of({
      step: ImplementationStep.IMPLEMENT, task: 1, totalTasks: 2, name: 'First task', attempt: 1, discards: 0,
    }))

    await fixture.refresh()

    expect(fixture.activePlans.known()[0]?.phase).toBe('implementing')
    expect(fixture.pullRequestReviews.startRecovered).toHaveBeenCalledExactlyOnceWith(fixture.watches[0])
  })

  it('replaces a changed agent handle and stops the previous watches', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.watches = [PlanWatchMother.of('owner/alpha', 7, 'workspace:99')]
    fixture.implementing.add('workspace:99')

    await fixture.refresh()

    expect(fixture.activePlans.known()).toEqual([expect.objectContaining({
      phase: 'implementing', plan: expect.objectContaining({ agent: 'workspace:99' }),
    })])
    expect(fixture.reviews.stop).toHaveBeenCalledTimes(1)
    expect(fixture.pullRequestReviews.startRecovered).toHaveBeenCalledExactlyOnceWith(fixture.watches[0])
  })

  it('preserves unchanged watches even when discovery returns new objects', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.watches = [PlanWatchMother.of()]

    await fixture.refresh()

    expect(fixture.reviews.startRecovered).toHaveBeenCalledTimes(1)
    expect(fixture.reviews.stop).not.toHaveBeenCalled()
  })

  it('does not regress an implementing session while its marker is still being persisted', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.activePlans.rememberImplementing(fixture.watches[0])

    await fixture.refresh()

    expect(fixture.activePlans.known()[0]?.phase).toBe('implementing')
    expect(fixture.reviews.startRecovered).toHaveBeenCalledTimes(1)
  })

  it('does not forget a plan started while an older discovery is waiting', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    const discovery = new Deferred<PlansInFlight>()
    fixture.plans.inFlight.mockReturnValueOnce(discovery.promise)
    const pending = fixture.refresh()
    fixture.sessions.remember(PlanWatchMother.of('owner/alpha', 8))
    discovery.resolve(PlansInFlight.listed(fixture.watches))

    await pending

    expect(fixture.activePlans.known().map((entry) => entry.plan.issue.number)).toEqual([7, 8])
  })

  it('does not remove a plan authorized while an older discovery is waiting', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    const discovery = new Deferred<PlansInFlight>()
    fixture.plans.inFlight.mockReturnValueOnce(discovery.promise)
    const pending = fixture.refresh()
    fixture.activePlans.rememberImplementing(fixture.watches[0])
    discovery.resolve(PlansInFlight.listed([]))

    await pending

    expect(fixture.activePlans.known()[0]?.phase).toBe('implementing')
    expect(fixture.reviews.stop).not.toHaveBeenCalled()
  })

  it('stages all phase reads before changing any known plan', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    const third = PlanWatchMother.of('owner/alpha', 9)
    fixture.watches = [PlanWatchMother.of('owner/alpha', 8), third]
    fixture.authorized.add(third.agent)
    fixture.implementationProgress.of.mockRejectedValueOnce(new TypeError('unexpected reader failure'))

    await expect(fixture.refresh()).rejects.toThrow('unexpected reader failure')

    expect(fixture.activePlans.known().map((entry) => entry.plan.issue.number)).toEqual([7])
    expect(fixture.reviews.startRecovered).toHaveBeenCalledTimes(1)
    expect(fixture.reviews.stop).not.toHaveBeenCalled()
  })

  it('shares discovery between simultaneous callers', async () => {
    const fixture = new RecoveryFixture()
    const discovery = new Deferred<PlansInFlight>()
    fixture.plans.inFlight.mockReturnValueOnce(discovery.promise)
    const first = fixture.recovery.recover()
    const second = fixture.recovery.recover()
    discovery.resolve(PlansInFlight.listed(fixture.watches))

    expect(await Promise.all([first, second])).toEqual([null, null])
    expect(fixture.plans.inFlight).toHaveBeenCalledTimes(1)
    expect(fixture.reviews.startRecovered).toHaveBeenCalledTimes(1)
  })

  it('reuses a fresh discovery until the injected interval elapses', async () => {
    const fixture = new RecoveryFixture()
    await fixture.recovery.recover()
    fixture.time = 14_999
    await fixture.recovery.recover()
    expect(fixture.plans.inFlight).toHaveBeenCalledTimes(1)

    fixture.time = 15_000
    await fixture.recovery.recover()

    expect(fixture.plans.inFlight).toHaveBeenCalledTimes(2)
  })
})
