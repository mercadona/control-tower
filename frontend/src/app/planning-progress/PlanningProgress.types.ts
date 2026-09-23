const PlanningActivityState = Object.freeze({
  RUNNING: 'running',
  FINISHED: 'finished',
} as const)

type PlanningActivityStateValue = (typeof PlanningActivityState)[keyof typeof PlanningActivityState]

type PlanningToolCall = {
  name: string
  argument: string | null
}

type PlanningActivity = {
  state: PlanningActivityStateValue
  runningMs: number
  toolCalls: number
  lastTool: PlanningToolCall | null
  lastText: string | null
}

export { PlanningActivityState }
export type { PlanningActivity, PlanningActivityStateValue, PlanningToolCall }
