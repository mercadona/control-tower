import { describe, expect, it } from 'vitest'
import {
  DeliverHeldMessages, DeliverHeldMessagesParams,
} from '../../src/application/actions/deliver-held-messages.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { CallMeasurements } from '../../src/domain/ports/call-measurements.ts'
import { PlanCalls } from '../../src/domain/ports/plan-calls.ts'
import { SliceEscalations } from '../../src/domain/ports/slice-escalations.ts'
import { SliceMessages } from '../../src/domain/ports/slice-messages.ts'
import { SliceEscalation } from '../../src/domain/value-objects/slice-escalation.ts'
import { HeldMessage } from '../../src/domain/value-objects/held-message.ts'
import {
  CompletedPlanCall, StartedPlanCall, type CallExecution,
} from '../../src/domain/value-objects/plan-call.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'

class DrainMother {
  static readonly WATCH = new PlanWatch({
    story: null,
    issue: new PlanIssue({
      number: 423,
      url: 'https://github.com/mercadona/control-tower/issues/423',
    }),
    located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/423', branch: 'feat/423' }),
    repository: new RepositoryName('mercadona/control-tower'),
    agent: 'conversation-423',
  })

  static held(ticket: string, text: string): HeldMessage {
    return new HeldMessage({ ticket, askedAt: `2026-09-19T10:00:0${ticket.length}.000Z`, text })
  }

  static completed(call: StartedPlanCall, execution: CallExecution = { kind: 'success' }, code = 0): CompletedPlanCall {
    return new CompletedPlanCall({
      call,
      code,
      signal: null,
      finishedAt: '2026-09-19T10:01:00.000Z',
      wallDurationMs: 30,
      execution,
      measurement: {
        cost: { kind: 'unavailable', reason: 'application boundary fixture' },
        turns: null,
        durationMs: null,
        unavailable: ['cost', 'turns', 'durationMs'],
      },
    })
  }
}

class SliceMessagesDouble extends SliceMessages {
  readonly trace: string[]
  held: HeldMessage[]

  constructor(trace: string[], held: readonly HeldMessage[]) {
    super()
    this.trace = trace
    this.held = [...held]
  }

  override async hold(): Promise<string> {
    throw new Error('the drain never holds a change')
  }

  override async pending(): Promise<readonly HeldMessage[]> {
    return Object.freeze([...this.held])
  }

  override async settle(watch: PlanWatch, ticket: string, call: string): Promise<void> {
    this.trace.push(`settle:${ticket}:${call}`)
    this.held = this.held.filter((message) => message.ticket !== ticket)
  }
}

class SliceEscalationsDouble extends SliceEscalations {
  readonly trace: string[]

  constructor(trace: string[]) {
    super()
    this.trace = trace
  }

  override async of(): Promise<SliceEscalation> {
    return SliceEscalation.none()
  }

  override async lift(asked: { issue: number }): Promise<void> {
    this.trace.push(`lift:${asked.issue}`)
  }
}

class PlanCallsDouble extends PlanCalls {
  readonly trace: string[]
  readonly failing: string | null

  constructor(trace: string[], failing: string | null = null) {
    super()
    this.trace = trace
    this.failing = failing
  }

  override async start(
    watch: PlanWatch,
    purpose: string,
    changes: string | null,
    requestId?: string,
  ): Promise<StartedPlanCall> {
    this.trace.push(`start:${purpose}:${String(requestId)}:${String(changes)}`)
    return new StartedPlanCall({ conversation: watch.agent, id: `call-${String(requestId)}` })
  }

  override async wait(call: StartedPlanCall): Promise<CompletedPlanCall> {
    this.trace.push(`wait:${call.id}`)
    if (this.failing !== null && call.id === this.failing) {
      return DrainMother.completed(call, { kind: 'error', diagnostic: 'the agent refused' }, 1)
    }
    return DrainMother.completed(call)
  }
}

class CallMeasurementsDouble extends CallMeasurements {
  readonly trace: string[]

  constructor(trace: string[]) {
    super()
    this.trace = trace
  }

  override async capture(call: StartedPlanCall): Promise<void> {
    this.trace.push(`capture:${call.id}`)
  }
}

describe('DeliverHeldMessages', () => {
  it('every held change reaches the conversation in order and settles', async () => {
    const trace: string[] = []
    const messages = new SliceMessagesDouble(trace, [
      DrainMother.held('a', 'drop the flag'),
      DrainMother.held('bb', 'rename the port'),
    ])
    const drain = new DeliverHeldMessages({
      messages,
      calls: new PlanCallsDouble(trace),
      measurements: new CallMeasurementsDouble(trace),
      escalations: new SliceEscalationsDouble(trace),
    })

    await drain.execute(new DeliverHeldMessagesParams({ watch: DrainMother.WATCH }))

    expect(trace).toEqual([
      'start:fix:message:a:drop the flag',
      'wait:call-message:a',
      'capture:call-message:a',
      'settle:a:call-message:a',
      'start:fix:message:bb:rename the port',
      'wait:call-message:bb',
      'capture:call-message:bb',
      'settle:bb:call-message:bb',
      `lift:${DrainMother.WATCH.issue.number}`,
    ])
    expect(await messages.pending()).toEqual([])
  })

  it('a change that did not succeed leaves the rest held', async () => {
    const trace: string[] = []
    const messages = new SliceMessagesDouble(trace, [
      DrainMother.held('a', 'drop the flag'),
      DrainMother.held('bb', 'rename the port'),
    ])
    const drain = new DeliverHeldMessages({
      messages,
      calls: new PlanCallsDouble(trace, 'call-message:a'),
      measurements: new CallMeasurementsDouble(trace),
      escalations: new SliceEscalationsDouble(trace),
    })

    await expect(drain.execute(new DeliverHeldMessagesParams({ watch: DrainMother.WATCH })))
      .rejects.toThrow(PlanAgentNotResumed)

    expect(trace).toEqual(['start:fix:message:a:drop the flag', 'wait:call-message:a', 'capture:call-message:a'])
    expect((await messages.pending()).map((message) => message.ticket)).toEqual(['a', 'bb'])
  })

  it('a watch with nothing held starts no call', async () => {
    const trace: string[] = []
    const drain = new DeliverHeldMessages({
      messages: new SliceMessagesDouble(trace, []),
      calls: new PlanCallsDouble(trace),
      measurements: new CallMeasurementsDouble(trace),
      escalations: new SliceEscalationsDouble(trace),
    })

    await drain.execute(new DeliverHeldMessagesParams({ watch: DrainMother.WATCH }))

    expect(trace).toEqual([])
  })
})
