import { PlanningActivity, PlanningActivityState, PlanningProgressOutcome, PlanningToolCall } from 'app/planning-progress/PlanningProgress.types'

const PATH = (issue: number) => `/planning-progress/${issue}`
const REPO_FIELD = 'repo'
const NOT_WATCHED_CODE = 'not-watched'
const NOT_READ_CODE = 'planning-progress-not-read'
const KNOWN_STATES: readonly string[] = Object.values(PlanningActivityState)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

type PlanningActivityWire = {
  state: string
  running_ms: number
  tool_calls: number
  last_tool?: unknown
  last_text: string | null
}

const isPlanningActivityWire = (value: unknown): value is PlanningActivityWire =>
  isRecord(value) &&
  typeof value.state === 'string' &&
  KNOWN_STATES.includes(value.state) &&
  typeof value.running_ms === 'number' &&
  typeof value.tool_calls === 'number' &&
  isStringOrNull(value.last_text)

const isLastToolWire = (value: unknown): value is PlanningToolCall =>
  isRecord(value) && typeof value.name === 'string' && isStringOrNull(value.argument)

const toLastTool = (value: unknown): PlanningToolCall | null => (isLastToolWire(value) ? { name: value.name, argument: value.argument } : null)

const toActivity = (wire: PlanningActivityWire): PlanningActivity => ({
  state: wire.state as PlanningActivity['state'],
  runningMs: wire.running_ms,
  toolCalls: wire.tool_calls,
  lastTool: wire.last_tool === undefined || wire.last_tool === null ? null : toLastTool(wire.last_tool),
  lastText: wire.last_text,
})

const isRefusal = (value: unknown): value is { code: string; detail: string } =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

const get = async ({ issue, repo }: { issue: number; repo: string }): Promise<PlanningProgressOutcome> => {
  let response: Response
  try {
    response = await fetch(`${PATH(issue)}?${REPO_FIELD}=${encodeURIComponent(repo)}`)
  } catch {
    return { kind: 'backend-unreachable' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }

  if (response.ok) {
    if (!isPlanningActivityWire(body)) return { kind: 'backend-unreachable' }
    return { kind: 'read', activity: toActivity(body) }
  }

  if (!isRefusal(body)) return { kind: 'backend-unreachable' }
  if (body.code === NOT_WATCHED_CODE) return { kind: 'not-watched' }
  if (body.code === NOT_READ_CODE) return { kind: 'not-read' }
  return { kind: 'refused', error: body.detail }
}

export const PlanningProgressClient = { get }
