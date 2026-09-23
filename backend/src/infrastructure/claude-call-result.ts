import { CompletedPlanCall, type StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import { ClaudeResultEnvelope } from './claude-result-envelope.ts'

export class ClaudeCallResult {
  static async read(asked: {
    lines: AsyncIterable<string>,
    call: StartedPlanCall,
    code: number | null,
    signal: string | null,
    finishedAt: string,
    wallDurationMs: number,
    mode: 'initial' | 'resume',
  }): Promise<CompletedPlanCall> {
    let stream = ''
    for await (const chunk of asked.lines) stream += chunk
    const reading = ClaudeResultEnvelope.read(stream, asked.call.conversation)
    return new CompletedPlanCall({
      call: asked.call,
      code: asked.code,
      signal: asked.signal,
      finishedAt: asked.finishedAt,
      wallDurationMs: asked.wallDurationMs,
      execution: reading.kind === 'result'
        ? reading.result.execution(asked.code)
        : { kind: 'unavailable', diagnostic: reading.diagnostic },
      measurement: reading.kind === 'result'
        ? reading.result.measurement(asked.mode)
        : {
          cost: { kind: 'unavailable', reason: reading.diagnostic },
          turns: null, durationMs: null, unavailable: [reading.diagnostic],
        },
    })
  }
}
