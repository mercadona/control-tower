import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CompletedPlanCall, PlanCallPurpose, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import { CallDescriptor, type ClaudeCalls } from './claude-calls.ts'
import { HeadlessFiles } from './headless-files.ts'

type JsonRecord = Record<string, unknown>
type MeasurementScope = 'initial-invocation' | 'unverified-resume' | 'reported-only'
type MetricKind = 'counter' | 'amount'
type ProjectedValue = { readonly kind: 'included', readonly value: unknown }
  | { readonly kind: 'omitted' }
type TerminalReading = { readonly kind: 'ignored' }
  | { readonly kind: 'invalid', readonly diagnostic: string }
  | { readonly kind: 'result', readonly terminal: TerminalResult }
type TerminalProjection = { readonly kind: 'matched', readonly measurements: ReportedMeasurements }
  | { readonly kind: 'conflict', readonly diagnostic: string }

class TerminalResult {
  static readonly #DIRECT = Object.freeze([
    ['total_cost_usd', 'amount'],
    ['num_turns', 'counter'],
    ['duration_ms', 'amount'],
    ['duration_api_ms', 'amount'],
    ['ttft_ms', 'amount'],
    ['ttft_stream_ms', 'amount'],
    ['queued_turn_count', 'counter'],
    ['result_index', 'counter'],
  ] as const)
  static readonly #GROUPS = Object.freeze(['usage', 'modelUsage', 'subagent_stats'] as const)
  static readonly #CONTAINERS = Object.freeze([
    'usage',
    'modelUsage',
    'subagent_stats',
    'output_tokens_details',
    'server_tool_use',
    'cache_creation',
    'iterations',
    'killed',
    'refused',
    'requested',
    'by_type',
  ])

  readonly #identity: string
  readonly #payload: JsonRecord

  private constructor(payload: JsonRecord) {
    this.#identity = JSON.stringify(payload)
    this.#payload = payload
  }

  static read(line: string): TerminalReading {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { kind: 'invalid', diagnostic: 'Claude stream ended with malformed JSON' }
    }
    if (!TerminalResult.#isRecord(parsed) || parsed.type !== 'result') return { kind: 'ignored' }
    if (typeof parsed.session_id !== 'string') {
      return { kind: 'invalid', diagnostic: 'Claude result did not carry a readable session identity' }
    }
    return { kind: 'result', terminal: new TerminalResult(parsed) }
  }

  sameIdentity(other: TerminalResult): boolean {
    return this.#identity === other.#identity
  }

  belongsTo(conversation: string): boolean {
    return this.#payload.session_id === conversation
  }

  project(completion: CompletedPlanCall, mode: 'initial' | 'resume'): TerminalProjection {
    if (!this.#matches(completion)) {
      return { kind: 'conflict', diagnostic: 'Claude result conflicts with its recorded completion' }
    }
    const reported: JsonRecord = {}
    const diagnostics: string[] = []
    for (const [key, kind] of TerminalResult.#DIRECT) {
      const scope = key === 'total_cost_usd'
        ? mode === 'initial' ? 'initial-invocation' : 'unverified-resume'
        : 'reported-only'
      TerminalResult.#direct(this.#payload, reported, key, kind, scope, diagnostics)
    }
    for (const key of TerminalResult.#GROUPS) {
      if (!(key in this.#payload) || this.#payload[key] === null) continue
      const projected = TerminalResult.#group(
        this.#payload[key],
        `/${TerminalResult.#escape(key)}`,
        diagnostics,
      )
      if (projected.kind === 'included') reported[key] = projected.value
    }
    const extra: JsonRecord = {}
    TerminalResult.#extra(this.#payload, '', extra, diagnostics)
    if (Object.keys(extra).length > 0) reported.extra = extra
    return {
      kind: 'matched',
      measurements: ReportedMeasurements.projected(reported, diagnostics),
    }
  }

  static #direct(
    source: JsonRecord,
    target: JsonRecord,
    key: string,
    kind: MetricKind,
    scope: MeasurementScope,
    diagnostics: string[],
  ): void {
    if (!(key in source) || source[key] === undefined) return
    const path = `/${TerminalResult.#escape(key)}`
    const value = TerminalResult.#metric(path, source[key], kind, scope, diagnostics)
    if (value.kind === 'included') target[key] = value.value
  }

  static #group(value: unknown, path: string, diagnostics: string[]): ProjectedValue {
    const expected = TerminalResult.#expectedGroupKind(path)
    if (expected !== null) return TerminalResult.#metric(path, value, expected, 'reported-only', diagnostics)
    if (typeof value === 'string') {
      return { kind: 'included', value }
    }
    if (typeof value === 'number') {
      return TerminalResult.#metric(
        path,
        value,
        TerminalResult.#groupKind(path),
        'reported-only',
        diagnostics,
      )
    }
    if (Array.isArray(value)) {
      const projected = value.map((item, index) => {
        const child = TerminalResult.#group(item, `${path}/${index}`, diagnostics)
        return child.kind === 'included' ? child.value : {}
      })
      return { kind: 'included', value: projected }
    }
    if (!TerminalResult.#isRecord(value)) return { kind: 'omitted' }
    const projected: JsonRecord = {}
    for (const [key, childValue] of Object.entries(value)) {
      if (key === 'structured_output') continue
      const child = TerminalResult.#group(
        childValue,
        `${path}/${TerminalResult.#escape(key)}`,
        diagnostics,
      )
      if (child.kind === 'included') projected[key] = child.value
    }
    return { kind: 'included', value: projected }
  }

  static #extra(value: unknown, path: string, extra: JsonRecord, diagnostics: string[]): void {
    if (typeof value === 'number') {
      const metric = TerminalResult.#metric(
        path,
        value,
        TerminalResult.#extraKind(path),
        'reported-only',
        diagnostics,
      )
      if (metric.kind === 'included') extra[path] = metric.value
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => TerminalResult.#extra(item, `${path}/${index}`, extra, diagnostics))
      return
    }
    if (!TerminalResult.#isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'structured_output') continue
      if (path.length === 0 && (TerminalResult.#DIRECT.some(([direct]) => direct === key)
        || TerminalResult.#GROUPS.some((group) => group === key))) continue
      TerminalResult.#extra(
        child,
        `${path}/${TerminalResult.#escape(key)}`,
        extra,
        diagnostics,
      )
    }
  }

  static #metric(
    path: string,
    value: unknown,
    kind: MetricKind,
    scope: MeasurementScope,
    diagnostics: string[],
  ): ProjectedValue {
    const valid = typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && (kind === 'amount' || Number.isInteger(value))
    if (valid) return { kind: 'included', value: { value, scope } }
    diagnostics.push(`${path} was not a ${kind === 'counter' ? 'nonnegative integer' : 'finite nonnegative number'}`)
    return { kind: 'omitted' }
  }

  static #groupKind(path: string): MetricKind {
    const key = path.split('/').at(-1) ?? ''
    return TerminalResult.#isAmountKey(key) || !TerminalResult.#isCounterKey(key)
      ? 'amount'
      : 'counter'
  }

  static #expectedGroupKind(path: string): MetricKind | null {
    if (TerminalResult.#isContainerPath(path)) return null
    const key = path.split('/').at(-1) ?? ''
    if (TerminalResult.#isAmountKey(key)) return 'amount'
    if (TerminalResult.#isCounterKey(key)) return 'counter'
    return null
  }

  static #isContainerPath(path: string): boolean {
    const key = path.split('/').at(-1) ?? ''
    if (TerminalResult.#CONTAINERS.includes(key)) return true
    if (/^\/modelUsage\/[^/]+$/.test(path)) return true
    return /^\/usage\/iterations\/\d+$/.test(path)
  }

  static #isAmountKey(key: string): boolean {
    return /^(?:cost|costUSD|total_cost_usd)$/i.test(key) || /(?:duration|ttft|time).*ms$|_ms$/i.test(key)
  }

  static #isCounterKey(key: string): boolean {
    return /tokens?|requests?|count|index|turns?|depth|spawned|completed|failed|background|foreground|unset|parent|user|system|budget|limit|window/i.test(key)
  }

  #matches(completion: CompletedPlanCall): boolean {
    if (completion.execution.kind === 'success') {
      return this.#payload.subtype === 'success' && this.#payload.is_error === false && completion.code === 0
    }
    if (completion.execution.kind !== 'error') return false
    switch (this.#payload.subtype) {
      case 'error_during_execution':
      case 'error_max_turns':
      case 'error_max_budget_usd':
      case 'error_max_structured_output_retries':
        return this.#payload.is_error === true
      case 'success':
        return this.#payload.is_error === true || completion.code !== 0
      default:
        return false
    }
  }

  static #extraKind(path: string): MetricKind {
    const key = path.split('/').at(-1) ?? ''
    return /(?:^|_)count$|(?:^|_)index$|turns?$|tokens?$|requests?$/i.test(key) ? 'counter' : 'amount'
  }

  static #escape(value: string): string {
    return value.replaceAll('~', '~0').replaceAll('/', '~1')
  }

  static #isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
}

class ReportedMeasurements {
  readonly #reported: JsonRecord
  readonly #diagnostics: readonly string[]

  private constructor(reported: JsonRecord, diagnostics: readonly string[]) {
    this.#reported = reported
    this.#diagnostics = diagnostics
  }

  static empty(): ReportedMeasurements {
    return new ReportedMeasurements({}, [])
  }

  static projected(reported: JsonRecord, diagnostics: readonly string[]): ReportedMeasurements {
    return new ReportedMeasurements(reported, Object.freeze([...new Set(diagnostics)]))
  }

  text(asked: {
    conversation: string,
    callId: string,
    purpose: PlanCallPurpose,
    streamSha256: string | null,
    completionSha256: string,
    wallDurationMs: number,
    diagnostics: readonly string[],
  }): string {
    return `${JSON.stringify({
      version: 1,
      conversation: asked.conversation,
      callId: asked.callId,
      purpose: asked.purpose,
      source: {
        stream: { path: CallDescriptor.STREAM, sha256: asked.streamSha256 },
        completion: { path: CallDescriptor.COMPLETION, sha256: asked.completionSha256 },
      },
      reported: this.#reported,
      wallDurationMs: asked.wallDurationMs,
      diagnostics: [...new Set([...asked.diagnostics, ...this.#diagnostics])],
    }, null, 2)}\n`
  }
}

export class ClaudeRunMeasurements {
  static readonly FILE = 'measurements-v1.json'

  readonly files: HeadlessFiles
  readonly calls: ClaudeCalls

  constructor(ports: { files: HeadlessFiles, calls: ClaudeCalls }) {
    this.files = ports.files
    this.calls = ports.calls
  }

  async capture(call: StartedPlanCall): Promise<void> {
    const directory = this.files.callDirectory(call)
    const descriptorPath = join(directory, CallDescriptor.FILE)
    const streamPath = join(directory, CallDescriptor.STREAM)
    const completionPath = join(directory, CallDescriptor.COMPLETION)
    const descriptorText = await this.#required(descriptorPath)
    const descriptor = CallDescriptor.from(descriptorText)
    if (descriptor.conversation !== call.conversation) {
      throw new Error(
        `descriptor identity differs from call: expected ${JSON.stringify(call.conversation)}, `
        + `got ${JSON.stringify(descriptor.conversation)}`
      )
    }
    const completionText = await this.files.read(completionPath)
    if (completionText === null) return
    const completion = await this.calls.completed(call)
    if (completion === null) return
    const streamText = await this.files.read(streamPath)
    const diagnostics: string[] = []
    let reported = ReportedMeasurements.empty()
    if (completion.execution.kind === 'success' || completion.execution.kind === 'error') {
      if (streamText === null) diagnostics.push(`${CallDescriptor.STREAM} was absent`)
      else {
        const terminal = ClaudeRunMeasurements.#terminal(streamText, call.conversation)
        if (terminal.kind === 'invalid') diagnostics.push(terminal.diagnostic)
        if (terminal.kind === 'result') {
          const projection = terminal.terminal.project(completion, descriptor.mode())
          if (projection.kind === 'matched') reported = projection.measurements
          if (projection.kind === 'conflict') diagnostics.push(projection.diagnostic)
        }
      }
    }
    if (completion.execution.kind !== 'success') diagnostics.push(completion.execution.diagnostic)
    const text = reported.text({
      conversation: call.conversation,
      callId: call.id,
      purpose: descriptor.purpose,
      streamSha256: streamText === null ? null : ClaudeRunMeasurements.#digest(streamText),
      completionSha256: ClaudeRunMeasurements.#digest(completionText),
      wallDurationMs: completion.wallDurationMs,
      diagnostics,
    })
    await this.#writeOnceOrMatch(join(directory, ClaudeRunMeasurements.FILE), text)
  }

  async #required(path: string): Promise<string> {
    const text = await this.files.read(path)
    if (text === null) throw new Error(`${path} is absent`)
    return text
  }

  async #writeOnceOrMatch(path: string, text: string): Promise<void> {
    try {
      await this.files.writeOnce(path, text)
      return
    } catch (cause) {
      if (!HeadlessFiles.isSystemFailure(cause) || cause.code !== 'EEXIST') throw cause
    }
    const existing = await this.files.read(path)
    if (existing === null) throw new Error(`${path} is absent after immutable publication collided`)
    if (existing !== text) throw new Error(`${path} contains different bytes after immutable publication collided`)
  }

  static #terminal(stream: string, conversation: string): TerminalReading {
    const readings = stream.split('\n')
      .filter((line) => line.length > 0)
      .map((line) => TerminalResult.read(line))
    const invalid = readings.find((reading) => reading.kind === 'invalid')
    if (invalid?.kind === 'invalid') return invalid
    const results = readings.flatMap((reading) => reading.kind === 'result' ? [reading] : [])
    if (results.length === 0) return { kind: 'invalid', diagnostic: 'Claude did not report a result' }
    if (results.some((result) => !result.terminal.belongsTo(conversation))) {
      return { kind: 'invalid', diagnostic: 'Claude reported a result for another conversation' }
    }
    if (results.some((result) => !result.terminal.sameIdentity(results[0].terminal))) {
      return { kind: 'invalid', diagnostic: 'Claude reported conflicting results' }
    }
    return results[0]
  }

  static #digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }
}
