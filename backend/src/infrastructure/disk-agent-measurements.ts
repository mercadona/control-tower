import { join } from 'node:path'
import { AgentMeasurementStore } from '../domain/ports/agent-measurement-store.ts'
import { RunNotAdvanced, RunNotUnderstood } from '../domain/exceptions.ts'
import type { AgentCallMeasurements } from '../domain/value-objects/agent-call-measurements.ts'
import type { HeadlessFiles } from './headless-files.ts'

export class DiskAgentMeasurements extends AgentMeasurementStore {
  static readonly FILE = 'agent-measurements-v1.json'
  readonly files: HeadlessFiles

  constructor(ports: { files: HeadlessFiles }) {
    super()
    this.files = ports.files
  }

  async record(measurements: AgentCallMeasurements): Promise<void> {
    const path = join(this.files.callDirectory(measurements.completed.call), DiskAgentMeasurements.FILE)
    const text = DiskAgentMeasurements.#text(measurements)
    try {
      if (await this.files.writeOnceOrMatch(path, text) === 'conflict') {
        throw new RunNotUnderstood(`${path} contains different bytes after immutable publication collided`)
      }
    } catch (cause) {
      if (cause instanceof RunNotUnderstood || cause instanceof RunNotAdvanced) throw cause
      throw new RunNotAdvanced(`agent measurements could not be recorded at ${path}: ${String(cause)}`)
    }
  }

  static #text(measurements: AgentCallMeasurements): string {
    const completed = measurements.completed
    return `${JSON.stringify({
      version: 1,
      conversation: completed.call.conversation,
      callId: completed.call.id,
      provider: measurements.provider,
      purpose: measurements.purpose,
      requestId: measurements.requestId,
      role: measurements.role,
      startedAt: measurements.startedAt,
      finishedAt: completed.finishedAt,
      wallDurationMs: completed.wallDurationMs,
      code: completed.code,
      signal: completed.signal,
      execution: completed.execution,
      cost: completed.measurement.cost,
      turns: completed.measurement.turns,
      reportedDurationMs: completed.measurement.durationMs,
      tokens: measurements.tokens,
      models: measurements.models,
      diagnostics: measurements.diagnostics,
    }, null, 2)}\n`
  }
}
