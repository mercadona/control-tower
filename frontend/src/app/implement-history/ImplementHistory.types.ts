import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'

type ImplementationHistoryEntry = {
  step: ImplementationStep
  task: number | null
  taskName: string | null
  tasksTotal: number | null
  attempt: number | null
  outcome: string | null
  writtenAt: string | null
  durationMs: number | null
  summary: string | null
  ruling: string | null
  findingsTotal: number | null
  toolTotalTokens: number | null
}

type ImplementHistoryOutcome =
  | { kind: 'read'; entries: ImplementationHistoryEntry[] }
  | { kind: 'not-read' }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }

export type { ImplementationHistoryEntry, ImplementHistoryOutcome }
