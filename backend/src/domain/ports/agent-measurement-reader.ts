import type { AgentCallMeasurements } from '../value-objects/agent-call-measurements.ts'
import type { CompletedPlanCall } from '../value-objects/plan-call.ts'

export abstract class AgentMeasurementReader {
  abstract read(completed: CompletedPlanCall): Promise<AgentCallMeasurements>
}
