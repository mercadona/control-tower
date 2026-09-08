import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { FakeEventSource } from 'pages/home/__tests__/FakeEventSource'
import { PlanEventsClient } from 'app/plan-events/client'

const listenTo = () => {
  const states: string[] = []
  const failures: { code: string; detail: string }[] = []
  let refusals = 0
  let unreachables = 0

  const subscription = PlanEventsClient.watch(PlanEventsMother.ISSUE, 'owner/name', {
    onState: (state) => states.push(state),
    onFailure: (failure) => failures.push(failure),
    onRefused: () => (refusals += 1),
    onUnreachable: () => (unreachables += 1),
  })

  return {
    subscription,
    states,
    failures,
    refusals: () => refusals,
    unreachables: () => unreachables,
  }
}

describe('PlanEventsClient', () => {
  beforeEach(() => FakeEventSource.install())
  afterEach(() => vi.unstubAllGlobals())

  it('should watch the issue in the repo it was asked about', () => {
    listenTo()

    expect(FakeEventSource.last().url).toBe(PlanEventsMother.PATH)
  })

  it('should report every state frame as it arrives', () => {
    const { states } = listenTo()

    FakeEventSource.last().receive(PlanEventsMother.writing())
    FakeEventSource.last().receive(PlanEventsMother.ready())

    expect(states).toEqual(['writing', 'ready'])
  })

  it('should close the stream once the last state arrives', () => {
    listenTo()

    FakeEventSource.last().receive(PlanEventsMother.ready())

    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should report a failure frame with its code, and keep listening', () => {
    const { failures } = listenTo()

    FakeEventSource.last().failWith(PlanEventsMother.unreadable())

    expect(failures).toEqual([{ code: 'plan-progress-not-read', detail: 'git status could not say whether the plan is committed' }])
    expect(FakeEventSource.last().closes).toBe(0)
  })

  it('should recover once a state frame follows a failure frame', () => {
    const { states } = listenTo()

    FakeEventSource.last().failWith(PlanEventsMother.unreadable())
    FakeEventSource.last().receive(PlanEventsMother.writing())

    expect(states).toEqual(['writing'])
  })

  it('should report the backend as unreachable when the connection drops without a body', () => {
    const { unreachables } = listenTo()

    FakeEventSource.last().dropConnection()

    expect(unreachables()).toBe(1)
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should report a refusal, not unreachable, when the browser fails the connection for good', () => {
    const { refusals, unreachables } = listenTo()

    FakeEventSource.last().refuseBeforeOpen()

    expect(refusals()).toBe(1)
    expect(unreachables()).toBe(0)
  })

  it('should ignore a connection error the browser fires once the plan is ready', () => {
    const { unreachables } = listenTo()

    FakeEventSource.last().receive(PlanEventsMother.ready())
    FakeEventSource.last().dropConnection()

    expect(unreachables()).toBe(0)
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should close the stream when the caller closes the subscription', () => {
    const { subscription } = listenTo()

    subscription.close()

    expect(FakeEventSource.last().closes).toBe(1)
  })
})
