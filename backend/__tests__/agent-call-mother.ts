import { AgentCallMeasurements } from '../src/domain/value-objects/agent-call-measurements.ts'
import { CompletedPlanCall, StartedPlanCall } from '../src/domain/value-objects/plan-call.ts'

export class AgentCallMother {
  static readonly STARTED_AT = '2026-09-23T10:00:00.000Z'

  static call(): StartedPlanCall {
    return new StartedPlanCall({ conversation: 'conversation', id: 'call' })
  }

  static completed(failed = false): CompletedPlanCall {
    return new CompletedPlanCall({
      call: AgentCallMother.call(), code: failed ? 1 : 0, signal: null,
      finishedAt: '2026-09-23T10:00:02.000Z', wallDurationMs: 2000,
      execution: failed ? { kind: 'error', diagnostic: 'agent exhausted its budget' } : { kind: 'success' },
      measurement: {
        cost: { kind: 'unavailable', reason: 'this executor does not report cost' },
        turns: 2, durationMs: null, unavailable: [],
      },
    })
  }

  static measurements(completed: CompletedPlanCall): AgentCallMeasurements {
    return new AgentCallMeasurements({
      provider: 'scripted-agent', purpose: 'implementation', requestId: 'work-1', role: 'implementer',
      startedAt: AgentCallMother.STARTED_AT, completed,
      tokens: { input: 12, output: 5, cacheRead: 0, cacheCreation: null },
      models: ['scripted-model'], diagnostics: [],
    })
  }
}
