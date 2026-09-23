import { join } from 'node:path'
import { AgentMeasurementReader } from '../domain/ports/agent-measurement-reader.ts'
import { RunNotAdvanced, RunNotUnderstood } from '../domain/exceptions.ts'
import { AgentCallMeasurements } from '../domain/value-objects/agent-call-measurements.ts'
import type { CompletedPlanCall } from '../domain/value-objects/plan-call.ts'
import { CallDescriptor } from './claude-calls.ts'
import { ClaudeResultEnvelope } from './claude-result-envelope.ts'
import { HeadlessFiles } from './headless-files.ts'

export class ClaudeRunMeasurements extends AgentMeasurementReader {
  readonly files: HeadlessFiles

  constructor(ports: { files: HeadlessFiles }) {
    super()
    this.files = ports.files
  }

  async read(completed: CompletedPlanCall): Promise<AgentCallMeasurements> {
    try {
      return await this.#read(completed)
    } catch (cause) {
      if (cause instanceof RunNotAdvanced || cause instanceof RunNotUnderstood) throw cause
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new RunNotAdvanced(`measurement evidence for call ${completed.call.id} could not be read: ${String(cause)}`)
      }
      throw new RunNotUnderstood(`measurement evidence for call ${completed.call.id} could not be understood: ${String(cause)}`)
    }
  }

  async #read(completed: CompletedPlanCall): Promise<AgentCallMeasurements> {
    const directory = this.files.callDirectory(completed.call)
    const path = join(directory, CallDescriptor.FILE)
    const text = await this.files.read(path)
    if (text === null) throw new RunNotAdvanced(`${path} is absent`)
    const descriptor = CallDescriptor.from(text)
    if (descriptor.conversation !== completed.call.conversation) {
      throw new RunNotUnderstood(`descriptor identity differs from call ${completed.call.id}`)
    }
    const diagnostics = [...completed.measurement.unavailable]
    let result: ClaudeResultEnvelope | null = null
    if (completed.execution.kind === 'success' || completed.execution.kind === 'error') {
      const stream = await this.files.read(join(directory, CallDescriptor.STREAM))
      if (stream === null) diagnostics.push(`${CallDescriptor.STREAM} was absent`)
      else {
        const reading = ClaudeResultEnvelope.read(stream, completed.call.conversation)
        if (reading.kind === 'invalid') diagnostics.push(reading.diagnostic)
        else if (reading.result.execution(completed.code).kind !== completed.execution.kind) {
          diagnostics.push('Claude result conflicts with its recorded completion')
        } else {
          result = reading.result
          diagnostics.push(...result.usageDiagnostics)
        }
      }
    }
    if (completed.execution.kind !== 'success') diagnostics.push(completed.execution.diagnostic)
    const roleIndex = descriptor.argv.indexOf('--agent')
    return new AgentCallMeasurements({
      provider: 'claude-code',
      purpose: descriptor.purpose,
      requestId: descriptor.requestId,
      role: descriptor.role ?? (roleIndex === -1 ? null : descriptor.argv[roleIndex + 1] ?? null),
      startedAt: descriptor.startedAt,
      completed,
      tokens: result?.tokens ?? ClaudeResultEnvelope.UNKNOWN_TOKENS,
      models: result?.models ?? null,
      diagnostics: [...new Set(diagnostics)],
    })
  }
}
