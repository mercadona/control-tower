import type { PlanningToolCall } from './planning-activity.ts'

export class ImplementationActivity {
  readonly startedAt: string
  readonly lastToolCall: PlanningToolCall | null
  readonly lastText: string | null

  constructor(asked: { startedAt: string, lastToolCall: PlanningToolCall | null, lastText: string | null }) {
    this.startedAt = asked.startedAt
    this.lastToolCall = asked.lastToolCall
    this.lastText = asked.lastText
    Object.freeze(this)
  }
}
