import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { StartedPlanCall, type CompletedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { ClaudeCallResult } from '../../src/infrastructure/claude-call-result.ts'

type ReadOverrides = {
  readonly text?: string,
  readonly conversation?: string,
  readonly code?: number | null,
  readonly wallDurationMs?: number,
  readonly mode?: 'initial' | 'resume',
}

class ClaudeResultMother {
  static readonly INITIAL_CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly TURN_LIMIT_CONVERSATION = '22222222-2222-4222-8222-222222222222'

  static async capturedInitial(over: ReadOverrides = {}): Promise<CompletedPlanCall> {
    return ClaudeResultMother.read({
      text: await ClaudeResultMother.fixture('claude-result-initial.jsonl'),
      mode: 'initial',
      ...over,
    })
  }

  static async capturedResume(over: ReadOverrides = {}): Promise<CompletedPlanCall> {
    return ClaudeResultMother.read({
      text: await ClaudeResultMother.fixture('claude-result-resumed.jsonl'),
      mode: 'resume',
      ...over,
    })
  }

  static async capturedTurnLimit(over: ReadOverrides = {}): Promise<CompletedPlanCall> {
    return ClaudeResultMother.read({
      text: await ClaudeResultMother.fixture('claude-result-turn-limit.jsonl'),
      conversation: ClaudeResultMother.TURN_LIMIT_CONVERSATION,
      mode: 'initial',
      ...over,
    })
  }

  static syntheticResult(over: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: ClaudeResultMother.INITIAL_CONVERSATION,
      is_error: false,
      total_cost_usd: 0.25,
      num_turns: 1,
      duration_ms: 2000,
      ...over,
    })}\n`
  }

  static async read(over: ReadOverrides = {}): Promise<CompletedPlanCall> {
    return ClaudeCallResult.read({
      lines: ClaudeResultMother.lines(over.text ?? ClaudeResultMother.syntheticResult()),
      call: new StartedPlanCall({
        conversation: over.conversation ?? ClaudeResultMother.INITIAL_CONVERSATION,
        id: 'call-1',
      }),
      code: over.code === undefined ? 0 : over.code,
      signal: null,
      finishedAt: '2026-09-15T18:42:00.000Z',
      wallDurationMs: over.wallDurationMs ?? 5000,
      mode: over.mode ?? 'initial',
    })
  }

  static async *lines(...chunks: string[]): AsyncIterable<string> {
    yield* chunks
  }

  static fixture(name: string): Promise<string> {
    return readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8')
  }
}

describe('ClaudeCallResult', () => {
  it('a resumed reported total is retained without attributing it to the call', async () => {
    const resumed = await ClaudeResultMother.capturedResume()
    const initial = await ClaudeResultMother.capturedInitial()

    expect(resumed.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 1.051838, attribution: 'unverified-resume',
    })
    expect(resumed.attributableCostUsd).toBeNull()
    expect(resumed.execution.kind).toBe('error')
    expect(resumed.succeeded).toBe(false)
    expect(initial.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 0.4208795, attribution: 'initial-invocation',
    })
    expect(initial.attributableCostUsd).toBe(0.4208795)
    expect(initial.succeeded).toBe(true)
  })

  it('both captured errors retain reported totals turns and CLI durations despite exit zero', async () => {
    const resumed = await ClaudeResultMother.capturedResume()
    const turnLimit = await ClaudeResultMother.capturedTurnLimit()

    expect(resumed.measurement).toMatchObject({
      cost: { kind: 'reported', totalUsd: 1.051838 }, turns: 1, durationMs: 4876,
    })
    expect(turnLimit.measurement).toMatchObject({
      cost: { kind: 'reported', totalUsd: 0.42424649999999997 }, turns: 2, durationMs: 4784,
    })
    expect([resumed.execution.kind, turnLimit.execution.kind]).toEqual(['error', 'error'])
  })

  it('proven success survives unavailable numeric telemetry', async () => {
    const completed = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({
        total_cost_usd: 'not-a-number', num_turns: 'not-a-number', duration_ms: 'not-a-number',
      }),
    })

    expect(completed.succeeded).toBe(true)
    expect(completed.measurement.cost.kind).toBe('unavailable')
    expect(completed.measurement.turns).toBeNull()
    expect(completed.measurement.durationMs).toBeNull()
    expect(completed.measurement.unavailable).toHaveLength(3)
  })

  it('reported zero differs from absent cost and wall duration is separate', async () => {
    const reportedZero = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ total_cost_usd: 0, duration_ms: 0 }),
      wallDurationMs: 4321,
    })
    const absent = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ total_cost_usd: undefined }),
    })

    expect(reportedZero.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 0, attribution: 'initial-invocation',
    })
    expect(reportedZero.measurement.durationMs).toBe(0)
    expect(reportedZero.wallDurationMs).toBe(4321)
    expect(absent.measurement.cost.kind).toBe('unavailable')
  })

  it('foreign conflicting and partial results never report success', async () => {
    const valid = ClaudeResultMother.syntheticResult()
    const foreign = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ session_id: '33333333-3333-4333-8333-333333333333' }),
    })
    const conflicting = await ClaudeResultMother.read({
      text: `${valid}${ClaudeResultMother.syntheticResult({ total_cost_usd: 0.5 })}`,
    })
    const partial = await ClaudeResultMother.read({ text: `${valid}{"type":"result"` })

    expect([foreign, conflicting, partial].map((completed) => completed.execution.kind)).toEqual([
      'unavailable', 'unavailable', 'unavailable',
    ])
    expect([foreign, conflicting, partial].map((completed) => completed.measurement.cost.kind)).toEqual([
      'unavailable', 'unavailable', 'unavailable',
    ])
  })

  it('absent unknown and error subtypes with false never succeed', async () => {
    const absent = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ subtype: undefined }),
    })
    const unknown = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ subtype: 'new-result-kind' }),
    })
    const error = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ subtype: 'error_during_execution', is_error: false }),
    })
    const errorWithNonBoolean = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ subtype: 'error_max_turns', is_error: 'true' }),
    })
    const errorWithoutBoolean = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ subtype: 'error_max_turns', is_error: undefined }),
    })

    expect([absent, unknown, error, errorWithNonBoolean, errorWithoutBoolean]
      .map((completed) => completed.succeeded)).toEqual([false, false, false, false, false])
    expect([
      absent.execution.kind,
      unknown.execution.kind,
      error.execution.kind,
      errorWithNonBoolean.execution.kind,
      errorWithoutBoolean.execution.kind,
    ]).toEqual([
      'unavailable', 'unavailable', 'error', 'unavailable', 'unavailable',
    ])
    expect(errorWithNonBoolean.measurement.cost).toMatchObject({ kind: 'reported', totalUsd: 0.25 })
    expect(errorWithoutBoolean.measurement.cost).toMatchObject({ kind: 'reported', totalUsd: 0.25 })
  })

  it('success requires a false boolean and exit zero', async () => {
    const trueError = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ is_error: true }),
    })
    const nonBoolean = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ is_error: 'false' }),
    })
    const nonzero = await ClaudeResultMother.read({ code: 1 })
    const proven = await ClaudeResultMother.read()

    expect([trueError, nonBoolean, nonzero, proven].map((completed) => completed.succeeded)).toEqual([
      false, false, false, true,
    ])
    expect(nonBoolean.execution.kind).toBe('unavailable')
  })

  it('invalid numeric fields lose only their own measurement', async () => {
    const badCost = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ total_cost_usd: -1 }),
    })
    const badTurns = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ num_turns: 1.5 }),
    })
    const badDuration = await ClaudeResultMother.read({
      text: ClaudeResultMother.syntheticResult({ duration_ms: -1 }),
    })

    expect(badCost.measurement).toMatchObject({ turns: 1, durationMs: 2000 })
    expect(badCost.measurement.cost.kind).toBe('unavailable')
    expect(badTurns.measurement).toMatchObject({
      cost: { kind: 'reported', totalUsd: 0.25 }, turns: null, durationMs: 2000,
    })
    expect(badDuration.measurement).toMatchObject({
      cost: { kind: 'reported', totalUsd: 0.25 }, turns: 1, durationMs: null,
    })
  })

  it('unconsumed fields and identical results do not duplicate measurements', async () => {
    const line = ClaudeResultMother.syntheticResult({ future_cli_field: { retainedByClaude: true } })
    const ignored = `${JSON.stringify({ type: 'assistant', message: 'not a result' })}\n`
    const completed = await ClaudeResultMother.read({ text: `${ignored}${line}${line.trimEnd()}` })

    expect(completed.succeeded).toBe(true)
    expect(completed.measurement).toEqual({
      cost: { kind: 'reported', totalUsd: 0.25, attribution: 'initial-invocation' },
      turns: 1,
      durationMs: 2000,
      unavailable: [],
    })
    expect(Object.isFrozen(completed)).toBe(true)
    expect(Object.isFrozen(completed.measurement)).toBe(true)
    expect(Object.isFrozen(completed.measurement.cost)).toBe(true)
  })
})
