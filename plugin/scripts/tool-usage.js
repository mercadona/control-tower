import { TelemetryLines } from './telemetry-lines.js'

export const UsageStatus = Object.freeze({
  MEASURED: 'measured',
  PARTIAL: 'partial',
  UNMEASURED: 'unmeasured',
  NOT_READ: 'not-read',
  UNSUPPORTED: 'unsupported',
  ABSENT: 'absent',
})

export class IdentityCollapse {
  static MIXED = '(mixed)'

  static of(values, { blank } = {}) {
    const relevant = blank === undefined ? values : values.filter((value) => value !== blank)
    if (relevant.length === 0) return null
    const unique = [...new Set(relevant)]
    return unique.length === 1 ? unique[0] : IdentityCollapse.MIXED
  }
}

export class ToolIdentity {
  static MIXED = IdentityCollapse.MIXED
  static UNKNOWN = null

  constructor({ tool, version }) {
    this.tool = tool
    this.version = version
    Object.freeze(this)
  }

  static unknown() {
    return new ToolIdentity({ tool: ToolIdentity.UNKNOWN, version: ToolIdentity.UNKNOWN })
  }
}

export class ToolUsageFields {
  static TOOL = 'tool'
  static VERSION = 'tool_version'
  static STATUS = 'tool_usage_status'
  static INPUT_TOKENS = 'tool_input_tokens'
  static CACHED_INPUT_TOKENS = 'tool_cached_input_tokens'
  static OUTPUT_TOKENS = 'tool_output_tokens'
  static TOTAL_TOKENS = 'tool_total_tokens'
  static DURATION_STATUS = 'tool_duration_status'
  static ACTIVE_DURATION_MS = 'tool_active_duration_ms'
  static EVIDENCE = 'tool_usage_evidence'
  static GAPS = 'tool_usage_gaps'
}

export class ToolUsage {
  static #CONTRIBUTING = Object.freeze([UsageStatus.MEASURED])

  static #countOrNull(value, field) {
    if (value === null) return null
    if (!(Number.isInteger(value) && value >= 0)) {
      throw new Error(`${field} must be a non-negative integer or null, got ${JSON.stringify(value)}`)
    }
    return value
  }

  constructor({ identity, status, inputTokens, cachedInputTokens, outputTokens, durationStatus, activeDurationMs, evidence, gaps }) {
    if (!Object.values(UsageStatus).includes(status)) {
      throw new Error(`status must be a UsageStatus member, got ${JSON.stringify(status)}`)
    }
    if (!Object.values(UsageStatus).includes(durationStatus)) {
      throw new Error(`durationStatus must be a UsageStatus member, got ${JSON.stringify(durationStatus)}`)
    }
    const contributes = ToolUsage.#CONTRIBUTING.includes(status)
    const tokens = [inputTokens, cachedInputTokens, outputTokens]
    if (contributes !== tokens.every((count) => count !== null)) {
      throw new Error(`status ${status} disagrees with the token counts given, got ${JSON.stringify(tokens)}`)
    }
    const durationMeasured = ToolUsage.#CONTRIBUTING.includes(durationStatus)
    if (durationMeasured !== (activeDurationMs !== null)) {
      throw new Error(`durationStatus ${durationStatus} disagrees with the duration given, got ${JSON.stringify(activeDurationMs)}`)
    }
    this.identity = identity
    this.status = status
    this.inputTokens = ToolUsage.#countOrNull(inputTokens, ToolUsageFields.INPUT_TOKENS)
    this.cachedInputTokens = ToolUsage.#countOrNull(cachedInputTokens, ToolUsageFields.CACHED_INPUT_TOKENS)
    this.outputTokens = ToolUsage.#countOrNull(outputTokens, ToolUsageFields.OUTPUT_TOKENS)
    this.durationStatus = durationStatus
    this.activeDurationMs = ToolUsage.#countOrNull(activeDurationMs, ToolUsageFields.ACTIVE_DURATION_MS)
    this.evidence = Object.freeze([...evidence])
    this.gaps = ToolUsage.#countOrNull(gaps, ToolUsageFields.GAPS)
    Object.freeze(this)
  }

  get contributes() {
    return ToolUsage.#CONTRIBUTING.includes(this.status)
  }

  get totalTokens() {
    return this.contributes ? this.inputTokens + this.cachedInputTokens + this.outputTokens : null
  }

  get evidenceKey() {
    return [...this.evidence].sort().join(' ')
  }

  static measured({ identity, inputTokens, cachedInputTokens, outputTokens, evidence, durationStatus, activeDurationMs }) {
    return new ToolUsage({
      identity, status: UsageStatus.MEASURED, inputTokens, cachedInputTokens, outputTokens,
      durationStatus, activeDurationMs, evidence, gaps: 0,
    })
  }

  static partial({ identity, evidence, gaps, durationStatus, activeDurationMs }) {
    return new ToolUsage({
      identity, status: UsageStatus.PARTIAL, inputTokens: null, cachedInputTokens: null, outputTokens: null,
      durationStatus, activeDurationMs, evidence, gaps,
    })
  }

  static unmeasured({ identity, evidence = [], gaps = 0 }) {
    return ToolUsage.#withoutTokens({ identity, status: UsageStatus.UNMEASURED, evidence, gaps })
  }

  static notRead({ identity }) {
    return ToolUsage.#withoutTokens({ identity, status: UsageStatus.NOT_READ, evidence: [], gaps: null })
  }

  static unsupported() {
    return ToolUsage.#withoutTokens({ identity: ToolIdentity.unknown(), status: UsageStatus.UNSUPPORTED, evidence: [], gaps: null })
  }

  static #withoutTokens({ identity, status, evidence, gaps }) {
    return new ToolUsage({
      identity, status, inputTokens: null, cachedInputTokens: null, outputTokens: null,
      durationStatus: status, activeDurationMs: null, evidence, gaps,
    })
  }

  measures() {
    return {
      [ToolUsageFields.TOOL]: this.identity.tool,
      [ToolUsageFields.VERSION]: this.identity.version,
      [ToolUsageFields.STATUS]: this.status,
      [ToolUsageFields.INPUT_TOKENS]: this.inputTokens,
      [ToolUsageFields.CACHED_INPUT_TOKENS]: this.cachedInputTokens,
      [ToolUsageFields.OUTPUT_TOKENS]: this.outputTokens,
      [ToolUsageFields.TOTAL_TOKENS]: this.totalTokens,
      [ToolUsageFields.DURATION_STATUS]: this.durationStatus,
      [ToolUsageFields.ACTIVE_DURATION_MS]: this.activeDurationMs,
      [ToolUsageFields.EVIDENCE]: [...this.evidence],
      [ToolUsageFields.GAPS]: this.gaps,
    }
  }

  static ofRow(row) {
    const status = row[ToolUsageFields.STATUS]
    if (!Object.values(UsageStatus).includes(status)) return null
    const identity = new ToolIdentity({
      tool: ToolUsage.#textOrNull(row[ToolUsageFields.TOOL]),
      version: ToolUsage.#textOrNull(row[ToolUsageFields.VERSION]),
    })
    const tokens = [
      ToolUsage.#readCount(row[ToolUsageFields.INPUT_TOKENS]),
      ToolUsage.#readCount(row[ToolUsageFields.CACHED_INPUT_TOKENS]),
      ToolUsage.#readCount(row[ToolUsageFields.OUTPUT_TOKENS]),
    ]
    const evidence = Array.isArray(row[ToolUsageFields.EVIDENCE])
      ? row[ToolUsageFields.EVIDENCE].filter((entry) => typeof entry === 'string' && entry.length > 0)
      : []
    const gaps = ToolUsage.#readCount(row[ToolUsageFields.GAPS])
    const { durationStatus, activeDurationMs } = ToolUsage.#durationOf(row)
    if (status === UsageStatus.MEASURED && tokens.every((count) => count !== null)) {
      return ToolUsage.measured({
        identity, inputTokens: tokens[0], cachedInputTokens: tokens[1], outputTokens: tokens[2],
        evidence, durationStatus, activeDurationMs,
      })
    }
    if (status === UsageStatus.MEASURED) return ToolUsage.unmeasured({ identity, evidence, gaps: gaps ?? 0 })
    if (status === UsageStatus.PARTIAL) {
      return ToolUsage.partial({ identity, evidence, gaps: gaps ?? 0, durationStatus, activeDurationMs })
    }
    return new ToolUsage({
      identity, status, inputTokens: null, cachedInputTokens: null, outputTokens: null,
      durationStatus, activeDurationMs, evidence, gaps,
    })
  }

  static claimedIn(text) {
    const claimed = new Set()
    for (const row of TelemetryLines.objectsOf(text)) {
      const evidence = row[ToolUsageFields.EVIDENCE]
      if (!Array.isArray(evidence)) continue
      for (const request of evidence) if (typeof request === 'string' && request.length > 0) claimed.add(request)
    }
    return claimed
  }

  static #durationOf(row) {
    const declared = row[ToolUsageFields.DURATION_STATUS]
    const status = Object.values(UsageStatus).includes(declared) ? declared : UsageStatus.UNMEASURED
    const activeDurationMs = ToolUsage.#readCount(row[ToolUsageFields.ACTIVE_DURATION_MS])
    if (ToolUsage.#CONTRIBUTING.includes(status) === (activeDurationMs !== null)) {
      return { durationStatus: status, activeDurationMs }
    }
    return { durationStatus: UsageStatus.UNMEASURED, activeDurationMs: null }
  }

  static #readCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null
  }

  static #textOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null
  }
}

export class ToolUsageTotal {
  constructor({ identity, status, durationStatus, attempts, measured, durationMeasured, inputTokens, cachedInputTokens, outputTokens, activeDurationMs, gaps }) {
    this.identity = identity
    this.status = status
    this.durationStatus = durationStatus
    this.attempts = attempts
    this.measured = measured
    this.durationMeasured = durationMeasured
    this.inputTokens = inputTokens
    this.cachedInputTokens = cachedInputTokens
    this.outputTokens = outputTokens
    this.activeDurationMs = activeDurationMs
    this.gaps = gaps
    Object.freeze(this)
  }

  get totalTokens() {
    return this.measured === 0 ? null : this.inputTokens + this.cachedInputTokens + this.outputTokens
  }

  static of(text) {
    const seen = new Set()
    const statuses = []
    const durationStatuses = []
    const identities = []
    let attempts = 0
    let measured = 0
    let durationMeasured = 0
    let inputTokens = 0
    let cachedInputTokens = 0
    let outputTokens = 0
    let activeDurationMs = 0
    let gaps = 0
    for (const row of TelemetryLines.objectsOf(text)) {
      const usage = ToolUsage.ofRow(row)
      if (usage === null) continue
      const key = usage.evidenceKey
      if (key !== '' && seen.has(key)) continue
      if (key !== '') seen.add(key)
      attempts += 1
      statuses.push(usage.status)
      durationStatuses.push(usage.durationStatus)
      if (usage.identity.tool !== null) identities.push(usage.identity)
      gaps += usage.gaps ?? 0
      if (usage.contributes) {
        measured += 1
        inputTokens += usage.inputTokens
        cachedInputTokens += usage.cachedInputTokens
        outputTokens += usage.outputTokens
      }
      if (usage.activeDurationMs !== null) {
        durationMeasured += 1
        activeDurationMs += usage.activeDurationMs
      }
    }
    return new ToolUsageTotal({
      identity: ToolUsageTotal.#identityOf(identities),
      status: ToolUsageTotal.#collapse({ attempts, measured, statuses }),
      durationStatus: ToolUsageTotal.#collapse({ attempts, measured: durationMeasured, statuses: durationStatuses }),
      attempts,
      measured,
      durationMeasured,
      inputTokens: measured === 0 ? null : inputTokens,
      cachedInputTokens: measured === 0 ? null : cachedInputTokens,
      outputTokens: measured === 0 ? null : outputTokens,
      activeDurationMs: durationMeasured === 0 ? null : activeDurationMs,
      gaps: attempts === 0 ? null : gaps,
    })
  }

  static #identityOf(identities) {
    if (identities.length === 0) return ToolIdentity.unknown()
    return new ToolIdentity({
      tool: ToolUsageTotal.#agreedOn(identities.map((identity) => identity.tool)),
      version: ToolUsageTotal.#agreedOn(identities.map((identity) => identity.version)),
    })
  }

  static #agreedOn(values) {
    return IdentityCollapse.of(values)
  }

  static #collapse({ attempts, measured, statuses }) {
    if (attempts === 0) return UsageStatus.ABSENT
    if (measured === attempts) return UsageStatus.MEASURED
    if (measured > 0) return UsageStatus.PARTIAL
    const unique = [...new Set(statuses)]
    return unique.length === 1 ? unique[0] : UsageStatus.UNMEASURED
  }

  measures() {
    return {
      tool: this.identity.tool,
      toolVersion: this.identity.version,
      toolUsageStatus: this.status,
      toolUsageAttempts: this.attempts,
      toolUsageMeasured: this.measured,
      toolUsageGaps: this.gaps,
      toolInputTokens: this.inputTokens,
      toolCachedInputTokens: this.cachedInputTokens,
      toolOutputTokens: this.outputTokens,
      toolTotalTokens: this.totalTokens,
      toolDurationStatus: this.durationStatus,
      toolDurationMeasured: this.durationMeasured,
      toolActiveDurationMs: this.activeDurationMs,
    }
  }

  static NO_COUNTS = Object.freeze({
    tool: null, toolVersion: null, toolUsageStatus: null, toolUsageAttempts: null, toolUsageMeasured: null,
    toolUsageGaps: null, toolInputTokens: null, toolCachedInputTokens: null, toolOutputTokens: null,
    toolTotalTokens: null, toolDurationStatus: null, toolDurationMeasured: null, toolActiveDurationMs: null,
  })
}
