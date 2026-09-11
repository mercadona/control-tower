import { ImplementationHistoryEntry, ImplementHistoryOutcome } from 'app/implement-history/ImplementHistory.types'
import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'

const PATH = (issue: number) => `/implement-history/${issue}`
const ROOT_FIELD = 'root'
const REPO_FIELD = 'repo'
const NOT_READ_CODE = 'implementation-history-not-read'
const KNOWN_STEPS: readonly string[] = Object.values(ImplementationStep)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number'

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

type ImplementationHistoryEntryWire = {
  step: ImplementationStep
  task: number | null
  task_name: string | null
  tasks_total: number | null
  attempt: number | null
  outcome: string | null
  written_at: string | null
  duration_ms: number | null
  summary: string | null
}

const isEntryWire = (value: unknown): value is ImplementationHistoryEntryWire =>
  isRecord(value) &&
  typeof value.step === 'string' &&
  KNOWN_STEPS.includes(value.step) &&
  isNumberOrNull(value.task) &&
  isStringOrNull(value.task_name) &&
  isNumberOrNull(value.tasks_total) &&
  isNumberOrNull(value.attempt) &&
  isStringOrNull(value.outcome) &&
  isStringOrNull(value.written_at) &&
  isNumberOrNull(value.duration_ms) &&
  isStringOrNull(value.summary)

type ImplementationHistoryWire = { steps: unknown[] }

const isHistoryWire = (value: unknown): value is ImplementationHistoryWire =>
  isRecord(value) && Array.isArray(value.steps)

const toEntry = (wire: ImplementationHistoryEntryWire): ImplementationHistoryEntry => ({
  step: wire.step,
  task: wire.task,
  taskName: wire.task_name,
  tasksTotal: wire.tasks_total,
  attempt: wire.attempt,
  outcome: wire.outcome,
  writtenAt: wire.written_at,
  durationMs: wire.duration_ms,
  summary: wire.summary,
})

const isRefusal = (value: unknown): value is { code: string; detail: string } =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

const get = async ({ issue, root, repo }: { issue: number; root: string; repo: string }): Promise<ImplementHistoryOutcome> => {
  let response: Response
  try {
    response = await fetch(
      `${PATH(issue)}?${ROOT_FIELD}=${encodeURIComponent(root)}&${REPO_FIELD}=${encodeURIComponent(repo)}`,
    )
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
    if (!isHistoryWire(body) || !body.steps.every(isEntryWire)) return { kind: 'backend-unreachable' }
    return { kind: 'read', entries: body.steps.map(toEntry) }
  }

  if (!isRefusal(body)) return { kind: 'backend-unreachable' }
  if (body.code === NOT_READ_CODE) return { kind: 'not-read' }
  return { kind: 'refused', error: body.detail }
}

export const ImplementHistoryClient = { get }
