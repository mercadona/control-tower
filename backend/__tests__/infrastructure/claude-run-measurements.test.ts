import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompletedPlanCall, StartedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { RunNotAdvanced, RunNotUnderstood } from '../../src/domain/exceptions.ts'
import type { AgentCallMeasurements } from '../../src/domain/value-objects/agent-call-measurements.ts'
import { ClaudeCallResult } from '../../src/infrastructure/claude-call-result.ts'
import { CallDescriptor, ClaudeCalls, StoredCompletion } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { ClaudeRunMeasurements } from '../../src/infrastructure/claude-run-measurements.ts'

type CaptureName = 'initial' | 'resumed' | 'turn-limit'
type CaptureMode = 'initial' | 'resume'
type Projection = {
  readonly version: unknown,
  readonly conversation: unknown,
  readonly callId: unknown,
  readonly purpose: unknown,
  readonly source: unknown,
  readonly reported: unknown,
  readonly wallDurationMs: unknown,
  readonly diagnostics: unknown,
}

class MeasurementMother {
  static readonly INITIAL_CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly TURN_LIMIT_CONVERSATION = '22222222-2222-4222-8222-222222222222'
  static readonly CALL_ID = '33333333-3333-4333-8333-333333333333'
  static readonly STARTED_AT = '2026-09-15T18:41:50.000Z'
  static readonly FINISHED_AT = '2026-09-15T18:42:00.000Z'
  static readonly roots: string[] = []

  static async captured(name: CaptureName, wallDurationMs = 9000): Promise<MeasurementScenario> {
    const stream = await readFile(new URL(`fixtures/claude-result-${name}.jsonl`, import.meta.url), 'utf8')
    return MeasurementMother.stream({
      stream,
      conversation: name === 'turn-limit'
        ? MeasurementMother.TURN_LIMIT_CONVERSATION
        : MeasurementMother.INITIAL_CONVERSATION,
      mode: name === 'resumed' ? 'resume' : 'initial',
      purpose: name === 'initial' ? 'plan' : 'implementation',
      wallDurationMs,
    })
  }

  static async stream(asked: {
    stream: string,
    conversation?: string,
    mode?: CaptureMode,
    purpose?: 'plan' | 'implementation' | 'fix',
    wallDurationMs?: number,
  }): Promise<MeasurementScenario> {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-measurements-'))
    MeasurementMother.roots.push(root)
    const conversation = asked.conversation ?? MeasurementMother.INITIAL_CONVERSATION
    const mode = asked.mode ?? 'initial'
    const call = new StartedPlanCall({ conversation, id: MeasurementMother.CALL_ID })
    const files = new HeadlessFiles({ root, fs, newId: () => 'measurement-temporary' })
    const directory = files.callDirectory(call)
    await fs.mkdir(directory, { recursive: true })
    const descriptor = new CallDescriptor({
      conversation,
      purpose: asked.purpose ?? 'plan',
      requestId: null,
      cwd: '/checkout/.worktrees/332',
      binary: '/usr/local/bin/claude',
      argv: [mode === 'initial' ? '--session-id' : '--resume', conversation],
      startedAt: MeasurementMother.STARTED_AT,
      budgetMs: 7200000,
      killGraceMs: 5000,
    }).text()
    const completed = await ClaudeCallResult.read({
      lines: MeasurementMother.lines(asked.stream),
      call,
      code: 0,
      signal: null,
      finishedAt: MeasurementMother.FINISHED_AT,
      wallDurationMs: asked.wallDurationMs ?? 9000,
      mode,
    })
    const completion = StoredCompletion.text(completed)
    await writeFile(join(directory, CallDescriptor.FILE), descriptor, 'utf8')
    await writeFile(join(directory, CallDescriptor.STREAM), asked.stream, 'utf8')
    await writeFile(join(directory, CallDescriptor.COMPLETION), completion, 'utf8')
    const calls = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: '/backend/src/infrastructure/headless-call-worker.ts',
      spawn: (await import('node:child_process')).spawn,
      env: {},
      newId: () => MeasurementMother.CALL_ID,
      now: () => MeasurementMother.FINISHED_AT,
      budgetMs: 7200000,
      killGraceMs: 5000,
      acceptanceMs: 10000,
      pollMs: 250,
      sleep: async () => {},
    })
    return new MeasurementScenario({ files, calls, call, descriptor, stream: asked.stream, completion })
  }

  static result(over: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: MeasurementMother.INITIAL_CONVERSATION,
      is_error: false,
      total_cost_usd: 0.25,
      num_turns: 1,
      duration_ms: 2000,
      duration_api_ms: 1800,
      ttft_ms: 100,
      ttft_stream_ms: 90,
      queued_turn_count: 0,
      result_index: 0,
      usage: { input_tokens: 2, service_tier: 'standard' },
      modelUsage: {
        'claude-sonnet-5': {
          inputTokens: 2,
          costUSD: 0.25,
          canonicalModel: 'claude-sonnet-5',
          provider: 'firstParty',
          costBasis: 'list',
        },
      },
      subagent_stats: { spawned: 0 },
      ...over,
    })}\n`
  }

  static async *lines(stream: string): AsyncIterable<string> {
    yield stream
  }

  static digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  static async clean(): Promise<void> {
    await Promise.all(MeasurementMother.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }
}

class MeasurementScenario {
  readonly files: HeadlessFiles
  readonly calls: ClaudeCalls
  readonly call: StartedPlanCall
  readonly descriptor: string
  readonly stream: string
  readonly completion: string

  constructor(asked: {
    files: HeadlessFiles,
    calls: ClaudeCalls,
    call: StartedPlanCall,
    descriptor: string,
    stream: string,
    completion: string,
  }) {
    this.files = asked.files
    this.calls = asked.calls
    this.call = asked.call
    this.descriptor = asked.descriptor
    this.stream = asked.stream
    this.completion = asked.completion
  }

  get directory(): string {
    return this.files.callDirectory(this.call)
  }

  get measurementPath(): string {
    return join(this.directory, 'measurements-v1.json')
  }

  async capture(): Promise<void> {
    const completed = await this.calls.completed(this.call)
    if (completed !== null) await new ClaudeRunMeasurements({ files: this.files }).read(completed)
  }

  async normalized(): Promise<AgentCallMeasurements> {
    const completed = await this.calls.completed(this.call)
    if (completed === null) throw new Error('the scenario has no completion')
    return new ClaudeRunMeasurements({ files: this.files }).read(completed)
  }

  async projection(): Promise<Projection> {
    return JSON.parse(await readFile(this.measurementPath, 'utf8'))
  }
}

afterEach(async () => MeasurementMother.clean())

describe('ClaudeRunMeasurements', () => {
  it.each([7, 'not a model map', [], { 'claude-sonnet-5': 7 }, { '': {} }].map((modelUsage) => ({ modelUsage })))(
    'malformed model metadata $modelUsage stays unknown instead of becoming model names', async ({ modelUsage }) => {
      const scenario = await MeasurementMother.stream({ stream: MeasurementMother.result({ modelUsage }) })

      const measurements = await scenario.normalized()

      expect(measurements.models).toBeNull()
      expect(measurements.diagnostics).toContain('modelUsage must map nonempty model names to usage objects')
    },
  )

  it('validating common model metadata preserves the historical provider projection', async () => {
    const scenario = await MeasurementMother.stream({ stream: MeasurementMother.result({ modelUsage: 7 }) })

    await scenario.normalized()

    expect(await scenario.projection()).toMatchObject({
      reported: { modelUsage: { value: 7, scope: 'reported-only' } }, diagnostics: [],
    })
  })

  it('measurements cannot attribute an in-memory completion that differs from its durable evidence', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const completed = await scenario.calls.wait(scenario.call)
    const changed = new CompletedPlanCall({ ...completed, wallDurationMs: 1 })

    await expect(new ClaudeRunMeasurements({ files: scenario.files }).read(changed))
      .rejects.toBeInstanceOf(RunNotUnderstood)

    await expect(readFile(scenario.measurementPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('missing durable completion is a read failure rather than fabricated terminal measurements', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const completed = await scenario.calls.wait(scenario.call)
    await rm(join(scenario.directory, CallDescriptor.COMPLETION))

    await expect(new ClaudeRunMeasurements({ files: scenario.files }).read(completed))
      .rejects.toBeInstanceOf(RunNotAdvanced)
  })

  it('the captured initial result supplies common metrics without adding model totals to invocation usage', async () => {
    const scenario = await MeasurementMother.captured('initial')

    const measurements = await scenario.normalized()

    expect(measurements.provider).toBe('claude-code')
    expect(measurements.startedAt).toBe(MeasurementMother.STARTED_AT)
    expect(measurements.completed.wallDurationMs).toBe(9000)
    expect(measurements.tokens).toEqual({ input: 2, output: 13, cacheRead: 0, cacheCreation: 167907 })
    expect(measurements.models).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5'])
    expect(measurements.completed.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 0.4208795, attribution: 'initial-invocation',
    })
  })

  it('a resumed result keeps zero usage distinct from unknown usage and its cost unattributable', async () => {
    const scenario = await MeasurementMother.captured('resumed')

    const measurements = await scenario.normalized()

    expect(measurements.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
    expect(measurements.completed.attributableCostUsd).toBeNull()
    expect(measurements.completed.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 1.051838, attribution: 'unverified-resume',
    })
    expect(measurements.diagnostics).toContain('Claude reported error_max_budget_usd')
  })

  it('invalid token counters stay unknown while valid zero survives in the common contract', async () => {
    const scenario = await MeasurementMother.stream({ stream: MeasurementMother.result({
      usage: { input_tokens: -1, output_tokens: '5', cache_read_input_tokens: 0 },
      modelUsage: undefined,
    }) })

    const measurements = await scenario.normalized()

    expect(measurements.tokens).toEqual({ input: null, output: null, cacheRead: 0, cacheCreation: null })
    expect(measurements.models).toBeNull()
    expect(measurements.diagnostics).toContain('/usage/input_tokens was not a nonnegative integer')
  })

  it('unreadable output leaves a diagnostic and durable timing rather than fabricated consumption', async () => {
    const scenario = await MeasurementMother.stream({ stream: '{broken\n', wallDurationMs: 4321 })

    const measurements = await scenario.normalized()

    expect(measurements.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheCreation: null })
    expect(measurements.completed.wallDurationMs).toBe(4321)
    expect(measurements.diagnostics.length).toBeGreaterThan(0)
  })

  it('the resumed capture retains reported totals and omits an own-call bill', async () => {
    const scenario = await MeasurementMother.captured('resumed', 6123)

    await scenario.capture()

    const projection = await scenario.projection()
    expect(projection).toMatchObject({ reported: {
      total_cost_usd: { value: 1.051838, scope: 'unverified-resume' },
      num_turns: { value: 1, scope: 'reported-only' },
      duration_ms: { value: 4876, scope: 'reported-only' },
    } })
    expect(projection.wallDurationMs).toBe(6123)
    expect(projection.diagnostics).toContain('Claude reported error_max_budget_usd')
    expect(JSON.stringify(projection.reported)).not.toMatch(/attributable|own.call|incremental|estimated/i)
  })

  it('all captured measurement groups retain their values and provenance', async () => {
    const initial = await MeasurementMother.captured('initial')
    const turnLimit = await MeasurementMother.captured('turn-limit')

    await initial.capture()
    await turnLimit.capture()

    const projectedInitial = await initial.projection()
    const projectedTurnLimit = await turnLimit.projection()
    expect(projectedInitial).toMatchObject({
      version: 1,
      conversation: MeasurementMother.INITIAL_CONVERSATION,
      callId: MeasurementMother.CALL_ID,
      purpose: 'plan',
    })
    expect(projectedInitial.source).toEqual({
      stream: { path: 'stream.ndjson', sha256: MeasurementMother.digest(initial.stream) },
      completion: { path: 'completion.json', sha256: MeasurementMother.digest(initial.completion) },
    })
    expect(projectedInitial).toMatchObject({ reported: {
      duration_api_ms: { value: 7387, scope: 'reported-only' },
      ttft_ms: { value: 6754, scope: 'reported-only' },
      ttft_stream_ms: { value: 4581, scope: 'reported-only' },
      queued_turn_count: { value: 0, scope: 'reported-only' },
      result_index: { value: 0, scope: 'reported-only' },
      usage: {
        input_tokens: { value: 2, scope: 'reported-only' },
        service_tier: 'standard',
        iterations: [{ input_tokens: { value: 2, scope: 'reported-only' }, type: 'message' }],
      },
      modelUsage: {
        'claude-sonnet-5': {
          costUSD: { value: 0.41990150000000004, scope: 'reported-only' },
          canonicalModel: 'claude-sonnet-5',
          provider: 'firstParty',
          costBasis: 'list',
        },
      },
      subagent_stats: {
        spawned: { value: 0, scope: 'reported-only' },
        killed: { system: { value: 0, scope: 'reported-only' } },
      },
      extra: {
        '/first_content_frame_ms': { value: 4581, scope: 'reported-only' },
        '/time_to_request_ms': { value: 333, scope: 'reported-only' },
      },
    } })
    expect(projectedTurnLimit).toMatchObject({ reported: {
      total_cost_usd: { value: 0.42424649999999997, scope: 'initial-invocation' },
      num_turns: { value: 2, scope: 'reported-only' },
      duration_ms: { value: 4784, scope: 'reported-only' },
      usage: { output_tokens_details: { thinking_tokens: { value: 15, scope: 'reported-only' } } },
    } })
  })

  it('missing invalid and conflicting metrics disappear while measured zero survives', async () => {
    const invalidShapes = [false, { value: 2 }, [2], null]
    const invalidShapeScenarios = await Promise.all(invalidShapes.map((invalidShape) => MeasurementMother.stream({
      stream: MeasurementMother.result({
        duration_api_ms: invalidShape,
        usage: {
          input_tokens: invalidShape,
          output_tokens_details: { thinking_tokens: 0 },
          sample_ratio: 0.5,
          service_tier: 'standard',
        },
        modelUsage: {
          'claude-sonnet-5': {
            costUSD: invalidShape,
            inputTokens: 0,
            canonicalModel: 'claude-sonnet-5',
            provider: 'firstParty',
            costBasis: 'list',
          },
        },
      }),
    })))
    const invalid = await MeasurementMother.stream({
      stream: MeasurementMother.result({
        duration_api_ms: -1,
        ttft_ms: undefined,
        queued_turn_count: 0,
        usage: {
          input_tokens: -2,
          output_tokens: 'invalid',
          cache_read_input_tokens: 0,
          sample_ratio: 0.5,
          service_tier: 'standard',
        },
        modelUsage: {
          'claude-sonnet-5': { costUSD: -0.1, inputTokens: 0, provider: 'firstParty', costBasis: 'list' },
        },
        structured_output: { confidence: 0.9, votes: 3 },
      }),
    })
    const first = MeasurementMother.result()
    const conflicting = await MeasurementMother.stream({
      stream: `${first}${MeasurementMother.result({ total_cost_usd: 0.5 })}`,
      wallDurationMs: 4321,
    })
    const malformed = await MeasurementMother.stream({ stream: '{"type":"result"\n' })
    const foreign = await MeasurementMother.stream({
      stream: MeasurementMother.result({ session_id: '44444444-4444-4444-8444-444444444444' }),
    })
    const pending = await MeasurementMother.captured('initial')
    await rm(join(pending.directory, CallDescriptor.COMPLETION))

    await Promise.all(invalidShapeScenarios.map((scenario) => scenario.capture()))
    await invalid.capture()
    await conflicting.capture()
    await malformed.capture()
    await foreign.capture()
    await pending.capture()

    const invalidShapeProjections = await Promise.all(invalidShapeScenarios.map((scenario) => scenario.projection()))
    const invalidProjection = await invalid.projection()
    const conflictingProjection = await conflicting.projection()
    const malformedProjection = await malformed.projection()
    const foreignProjection = await foreign.projection()
    for (const projection of invalidShapeProjections) {
      expect(projection).not.toHaveProperty('reported.duration_api_ms')
      expect(projection).not.toHaveProperty('reported.usage.input_tokens')
      expect(projection).not.toHaveProperty('reported.usage.input_tokens.value')
      expect(projection).not.toHaveProperty('reported.modelUsage.claude-sonnet-5.costUSD')
      expect(projection).not.toHaveProperty('reported.modelUsage.claude-sonnet-5.costUSD.value')
      expect(projection).toMatchObject({ reported: {
        usage: {
          output_tokens_details: { thinking_tokens: { value: 0, scope: 'reported-only' } },
          sample_ratio: { value: 0.5, scope: 'reported-only' },
          service_tier: 'standard',
        },
        modelUsage: {
          'claude-sonnet-5': {
            inputTokens: { value: 0, scope: 'reported-only' },
            canonicalModel: 'claude-sonnet-5',
            provider: 'firstParty',
            costBasis: 'list',
          },
        },
      } })
      expect(projection.diagnostics).toEqual(expect.arrayContaining([
        '/duration_api_ms was not a finite nonnegative number',
        '/usage/input_tokens was not a nonnegative integer',
        '/modelUsage/claude-sonnet-5/costUSD was not a finite nonnegative number',
      ]))
    }
    expect(invalidProjection).toMatchObject({ reported: {
      queued_turn_count: { value: 0, scope: 'reported-only' },
      usage: {
        cache_read_input_tokens: { value: 0, scope: 'reported-only' },
        sample_ratio: { value: 0.5, scope: 'reported-only' },
      },
      modelUsage: { 'claude-sonnet-5': { inputTokens: { value: 0, scope: 'reported-only' } } },
    } })
    expect(invalidProjection).not.toHaveProperty('reported.duration_api_ms')
    expect(invalidProjection).not.toHaveProperty('reported.ttft_ms')
    expect(invalidProjection).not.toHaveProperty('reported.usage.input_tokens')
    expect(invalidProjection).not.toHaveProperty('reported.usage.output_tokens')
    expect(invalidProjection).not.toHaveProperty('reported.modelUsage.claude-sonnet-5.costUSD')
    expect(invalidProjection).not.toHaveProperty('reported.structured_output')
    expect(invalidProjection).not.toHaveProperty('reported.extra./structured_output/confidence')
    expect(invalidProjection.diagnostics).toEqual(expect.arrayContaining([
      '/duration_api_ms was not a finite nonnegative number',
      '/usage/input_tokens was not a nonnegative integer',
      '/usage/output_tokens was not a nonnegative integer',
      '/modelUsage/claude-sonnet-5/costUSD was not a finite nonnegative number',
    ]))
    expect(conflictingProjection.reported).toEqual({})
    expect(conflictingProjection.wallDurationMs).toBe(4321)
    expect(conflictingProjection.diagnostics).toContain('Claude reported conflicting results')
    expect(malformedProjection.reported).toEqual({})
    expect(malformedProjection.diagnostics).toContain('Claude stream ended with malformed JSON')
    expect(foreignProjection.reported).toEqual({})
    expect(foreignProjection.diagnostics).toContain('Claude reported a result for another conversation')
    await expect(readFile(pending.measurementPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('projection publication preserves legacy bytes and accepts identical retries', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const descriptorPath = join(scenario.directory, CallDescriptor.FILE)
    const streamPath = join(scenario.directory, CallDescriptor.STREAM)
    const completionPath = join(scenario.directory, CallDescriptor.COMPLETION)

    await scenario.capture()
    const firstProjection = await readFile(scenario.measurementPath, 'utf8')
    await scenario.capture()

    expect(await readFile(scenario.measurementPath, 'utf8')).toBe(firstProjection)
    expect(await readFile(descriptorPath, 'utf8')).toBe(scenario.descriptor)
    expect(await readFile(streamPath, 'utf8')).toBe(scenario.stream)
    expect(await readFile(completionPath, 'utf8')).toBe(scenario.completion)

    const collision = await MeasurementMother.captured('initial')
    await writeFile(collision.measurementPath, '{}\n', 'utf8')
    await expect(collision.capture()).rejects.toThrow('contains different bytes')
    expect(await readFile(collision.measurementPath, 'utf8')).toBe('{}\n')
  })
})
