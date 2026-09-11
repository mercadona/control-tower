type ImplementationHistoryEntryFields = {
  step: string,
  task: number | null,
  taskName: string | null,
  tasksTotal: number | null,
  attempt: number | null,
  outcome: string | null,
  writtenAt: string | null,
  durationMs: number | null,
  summary: string | null,
}

export class ImplementationHistoryEntry {
  readonly step: string
  readonly task: number | null
  readonly taskName: string | null
  readonly tasksTotal: number | null
  readonly attempt: number | null
  readonly outcome: string | null
  readonly writtenAt: string | null
  readonly durationMs: number | null
  readonly summary: string | null

  constructor({ step, task, taskName, tasksTotal, attempt, outcome, writtenAt, durationMs, summary }: ImplementationHistoryEntryFields) {
    this.step = step
    this.task = task
    this.taskName = taskName
    this.tasksTotal = tasksTotal
    this.attempt = attempt
    this.outcome = outcome
    this.writtenAt = writtenAt
    this.durationMs = durationMs
    this.summary = summary
    Object.freeze(this)
  }

  static of(fields: ImplementationHistoryEntryFields): ImplementationHistoryEntry {
    return new ImplementationHistoryEntry(fields)
  }
}
