import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StartedPlanCall, type CompletedPlanCall } from '../../src/domain/value-objects/plan-call.ts'
import { RunNotAdvanced, RunNotUnderstood } from '../../src/domain/exceptions.ts'
import type { AgentCallMeasurements } from '../../src/domain/value-objects/agent-call-measurements.ts'
import { ClaudeCallResult } from '../../src/infrastructure/claude-call-result.ts'
import { CallDescriptor, StoredCompletion } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { ClaudeRunMeasurements } from '../../src/infrastructure/claude-run-measurements.ts'

class MeasurementMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly CALL_ID = '33333333-3333-4333-8333-333333333333'
  static readonly STARTED_AT = '2026-09-15T18:41:50.000Z'
  static readonly roots: string[] = []

  static async captured(name: 'initial' | 'resumed'): Promise<MeasurementScenario> {
    const stream = await readFile(new URL(`fixtures/claude-result-${name}.jsonl`, import.meta.url), 'utf8')
    return MeasurementMother.stream(stream, name === 'resumed' ? 'resume' : 'initial')
  }

  static async stream(stream: string, mode: 'initial' | 'resume' = 'initial'): Promise<MeasurementScenario> {
    const root = await mkdtemp(join(tmpdir(), 'ct-run-measurements-'))
    MeasurementMother.roots.push(root)
    const call = new StartedPlanCall({ conversation: MeasurementMother.CONVERSATION, id: MeasurementMother.CALL_ID })
    const files = new HeadlessFiles({ root, fs, newId: () => { throw new Error('reading measurements must not write') } })
    const directory = files.callDirectory(call)
    await fs.mkdir(directory, { recursive: true })
    const descriptor = new CallDescriptor({
      conversation: call.conversation,
      purpose: mode === 'initial' ? 'plan' : 'implementation',
      requestId: null,
      cwd: '/checkout/.worktrees/332',
      binary: '/usr/local/bin/claude',
      argv: [mode === 'initial' ? '--session-id' : '--resume', call.conversation],
      startedAt: MeasurementMother.STARTED_AT,
      budgetMs: 7200000,
      killGraceMs: 5000,
    }).text()
    const completed = await ClaudeCallResult.read({
      lines: MeasurementMother.lines(stream), call, code: 0, signal: null,
      finishedAt: '2026-09-15T18:42:00.000Z', wallDurationMs: 9000, mode,
    })
    await writeFile(join(directory, CallDescriptor.FILE), descriptor, 'utf8')
    await writeFile(join(directory, CallDescriptor.STREAM), stream, 'utf8')
    await writeFile(join(directory, CallDescriptor.COMPLETION), StoredCompletion.text(completed), 'utf8')
    return new MeasurementScenario(files, completed)
  }

  static result(over: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
      type: 'result', subtype: 'success', session_id: MeasurementMother.CONVERSATION,
      is_error: false, total_cost_usd: 0.25, num_turns: 1, duration_ms: 2000,
      usage: { input_tokens: 2 }, modelUsage: { 'claude-sonnet-5': { inputTokens: 2 } },
      ...over,
    })}\n`
  }

  static async *lines(stream: string): AsyncIterable<string> {
    yield stream
  }

  static async clean(): Promise<void> {
    await Promise.all(MeasurementMother.roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }
}

class MeasurementScenario {
  readonly files: HeadlessFiles
  readonly completed: CompletedPlanCall
  readonly directory: string
  readonly legacyPath: string

  constructor(files: HeadlessFiles, completed: CompletedPlanCall) {
    this.files = files
    this.completed = completed
    this.directory = files.callDirectory(completed.call)
    this.legacyPath = join(this.directory, 'measurements-v1.json')
  }

  normalized(): Promise<AgentCallMeasurements> {
    return new ClaudeRunMeasurements({ files: this.files }).read(this.completed)
  }
}

afterEach(async () => MeasurementMother.clean())

describe('ClaudeRunMeasurements', () => {
  it('reading measurements creates no provider-specific projection or other files', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const before = (await fs.readdir(scenario.directory)).sort()

    await scenario.normalized()

    expect((await fs.readdir(scenario.directory)).sort()).toEqual(before)
    await expect(readFile(scenario.legacyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('historical provider projections remain untouched and are not inputs to common measurements', async () => {
    const scenario = await MeasurementMother.captured('initial')
    await writeFile(scenario.legacyPath, 'historical bytes from an older version\n', 'utf8')

    const measurements = await scenario.normalized()

    expect(measurements.tokens.input).toBe(2)
    expect(await readFile(scenario.legacyPath, 'utf8')).toBe('historical bytes from an older version\n')
  })

  it('unconsumed numeric fields do not become metrics or validation failures', async () => {
    const scenario = await MeasurementMother.stream(MeasurementMother.result({
      future_metadata: { counter: -1, ratio: -0.5 }, structured_output: { tokens: -1 },
    }))

    const measurements = await scenario.normalized()

    expect(measurements.tokens.input).toBe(2)
    expect(measurements.diagnostics).toEqual([])
  })

  it('the reader uses the completed call supplied by the executor rather than rereading completion', async () => {
    const scenario = await MeasurementMother.captured('initial')
    await rm(join(scenario.directory, CallDescriptor.COMPLETION))

    const measurements = await scenario.normalized()

    expect(measurements.completed).toBe(scenario.completed)
    expect(measurements.tokens.input).toBe(2)
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

  it('a resumed error retains its available consumption and unattributable reported cost', async () => {
    const scenario = await MeasurementMother.captured('resumed')

    const measurements = await scenario.normalized()

    expect(measurements.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
    expect(measurements.completed.attributableCostUsd).toBeNull()
    expect(measurements.completed.measurement.cost).toEqual({
      kind: 'reported', totalUsd: 1.051838, attribution: 'unverified-resume',
    })
    expect(measurements.diagnostics).toContain('Claude reported error_max_budget_usd')
  })

  it.each([7, 'not a model map', [], { 'claude-sonnet-5': 7 }, { '': {} }].map((modelUsage) => ({ modelUsage })))(
    'malformed model metadata $modelUsage stays unknown instead of becoming model names', async ({ modelUsage }) => {
      const scenario = await MeasurementMother.stream(MeasurementMother.result({ modelUsage }))

      const measurements = await scenario.normalized()

      expect(measurements.models).toBeNull()
      expect(measurements.diagnostics).toContain('modelUsage must map nonempty model names to usage objects')
    },
  )

  it.each([false, { value: 2 }, [2], null, -1, 0.5, '5'].map((counter) => ({ counter })))(
    'invalid token counter $counter loses only its own measurement', async ({ counter }) => {
      const scenario = await MeasurementMother.stream(MeasurementMother.result({
        usage: { input_tokens: counter, output_tokens: 3, cache_read_input_tokens: 0 }, modelUsage: undefined,
      }))

      const measurements = await scenario.normalized()

      expect(measurements.tokens).toEqual({ input: null, output: 3, cacheRead: 0, cacheCreation: null })
      expect(measurements.models).toBeNull()
      expect(measurements.diagnostics).toContain('/usage/input_tokens was not a nonnegative integer')
    },
  )

  it('unreadable output leaves a diagnostic and durable timing rather than fabricated consumption', async () => {
    const scenario = await MeasurementMother.stream('{broken\n')

    const measurements = await scenario.normalized()

    expect(measurements.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheCreation: null })
    expect(measurements.completed.wallDurationMs).toBe(9000)
    expect(measurements.diagnostics).toEqual(['Claude stream ended with malformed JSON'])
  })

  it.each([7, 'not a usage object', []].map((usage) => ({ usage })))(
    'malformed usage container $usage cannot produce token counts', async ({ usage }) => {
      const scenario = await MeasurementMother.stream(MeasurementMother.result({ usage }))

      const measurements = await scenario.normalized()

      expect(measurements.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheCreation: null })
      expect(measurements.diagnostics).toContain('usage must be a usage object')
    },
  )

  it.each([
    { stream: '', diagnostic: 'Claude did not report a result' },
    { stream: '{broken\n', diagnostic: 'Claude stream ended with malformed JSON' },
    { stream: MeasurementMother.result({ session_id: 'foreign' }), diagnostic: 'Claude reported a result for another conversation' },
    { stream: MeasurementMother.result() + MeasurementMother.result({ total_cost_usd: 1 }), diagnostic: 'Claude reported conflicting results' },
    { stream: MeasurementMother.result({ subtype: 'error_max_turns', is_error: true }), diagnostic: 'Claude result conflicts with its recorded completion' },
  ])('changed source evidence reports $diagnostic instead of attributing its usage', async ({ stream, diagnostic }) => {
    const scenario = await MeasurementMother.captured('initial')
    await writeFile(join(scenario.directory, CallDescriptor.STREAM), stream, 'utf8')

    const measurements = await scenario.normalized()

    expect(measurements.completed).toBe(scenario.completed)
    expect(measurements.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheCreation: null })
    expect(measurements.models).toBeNull()
    expect(measurements.diagnostics).toContain(diagnostic)
  })

  it('an absent stream keeps the known completion and reports missing consumption', async () => {
    const scenario = await MeasurementMother.captured('initial')
    await rm(join(scenario.directory, CallDescriptor.STREAM))

    const measurements = await scenario.normalized()

    expect(measurements.completed).toBe(scenario.completed)
    expect(measurements.tokens.input).toBeNull()
    expect(measurements.diagnostics).toContain('stream.ndjson was absent')
  })

  it('an absent descriptor is a read failure', async () => {
    const scenario = await MeasurementMother.captured('initial')
    await rm(join(scenario.directory, CallDescriptor.FILE))

    await expect(scenario.normalized()).rejects.toBeInstanceOf(RunNotAdvanced)
  })

  it('a descriptor belonging to another conversation is refused', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const path = join(scenario.directory, CallDescriptor.FILE)
    const original = await readFile(path, 'utf8')
    await writeFile(path, original.replaceAll(MeasurementMother.CONVERSATION, 'foreign'), 'utf8')

    await expect(scenario.normalized()).rejects.toBeInstanceOf(RunNotUnderstood)
  })

  it('repeated readings preserve all execution evidence bytes', async () => {
    const scenario = await MeasurementMother.captured('initial')
    const paths = [CallDescriptor.FILE, CallDescriptor.STREAM, CallDescriptor.COMPLETION]
      .map((name) => join(scenario.directory, name))
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')))

    const first = await scenario.normalized()
    expect(await scenario.normalized()).toEqual(first)

    expect(await Promise.all(paths.map((path) => readFile(path, 'utf8')))).toEqual(before)
  })
})
