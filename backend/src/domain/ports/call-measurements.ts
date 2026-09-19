import type { StartedPlanCall } from '../value-objects/plan-call.ts'

export abstract class CallMeasurements {
  abstract capture(call: StartedPlanCall): Promise<void>
}
