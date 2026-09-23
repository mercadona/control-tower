import type { AgentCallMeasurements } from '../value-objects/agent-call-measurements.ts'

export abstract class AgentMeasurementStore {
  abstract record(measurements: AgentCallMeasurements): Promise<void>
}
