import { metricsRepoRelPath } from '../../../plugin/scripts/run-metrics.js'
import { ImplementationHistory } from '../domain/ports/implementation-history.ts'
import { ImplementationHistoryEntry } from '../domain/value-objects/implementation-history-entry.ts'
import { ImplementationHistoryNotRead } from '../domain/exceptions.ts'
import { GitWorkspace } from './git-workspace.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type MetricsRow = {
  step: string,
  task?: number | null,
  task_name?: string | null,
  tasks_total?: number | null,
  attempt?: number | null,
  outcome?: string | null,
  written_at?: string | null,
  duration_ms?: number | null,
  summary?: string | null,
}

export class MetricsFileHistory extends ImplementationHistory {
  readonly read: (path: string) => Promise<string | null>
  readonly exists: (path: string) => Promise<boolean>

  constructor({ read, exists }: {
    read: (path: string) => Promise<string | null>,
    exists: (path: string) => Promise<boolean>,
  }) {
    super()
    this.read = read
    this.exists = exists
  }

  static worktreeFor(root: string, issue: number): string {
    return GitWorkspace.pathFor(root, { number: issue })
  }

  static metricsFileFor(root: string, issue: number): string {
    return `${MetricsFileHistory.worktreeFor(root, issue)}/${metricsRepoRelPath(issue)}`
  }

  async of({ root, issue }: {
    root: CheckoutRoot,
    issue: number,
    repository?: RepositoryName,
  }): Promise<ImplementationHistoryEntry[]> {
    const worktree = MetricsFileHistory.worktreeFor(root.text, issue)
    if (!(await this.exists(worktree))) {
      throw new ImplementationHistoryNotRead(`the worktree ${worktree} is not there, so its history cannot be read`)
    }
    const path = MetricsFileHistory.metricsFileFor(root.text, issue)
    let text
    try {
      text = await this.read(path)
    } catch (cause) {
      throw new ImplementationHistoryNotRead(`${path} could not be read: ${MetricsFileHistory.#messageOf(cause)}`)
    }
    if (text === null) return []

    return MetricsFileHistory.#entriesOf(text, path)
  }

  static #entriesOf(text: string, path: string): ImplementationHistoryEntry[] {
    const lines = text.split('\n')
    const withoutTrailingEmpty = lines.at(-1) === '' ? lines.slice(0, -1) : lines

    return withoutTrailingEmpty.map((line, index) => MetricsFileHistory.#entryOf(line, index + 1, path))
  }

  static #entryOf(line: string, lineNumber: number, path: string): ImplementationHistoryEntry {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch (cause) {
      throw new ImplementationHistoryNotRead(
        `${path}: line ${lineNumber} is not valid JSON: ${MetricsFileHistory.#messageOf(cause)}`
      )
    }
    if (!MetricsFileHistory.#holdsARow(row)) {
      throw new ImplementationHistoryNotRead(`${path}: line ${lineNumber} did not hold a JSON object`)
    }

    return ImplementationHistoryEntry.of({
      step: row.step,
      task: row.task ?? null,
      taskName: row.task_name ?? null,
      tasksTotal: row.tasks_total ?? null,
      attempt: row.attempt ?? null,
      outcome: row.outcome ?? null,
      writtenAt: row.written_at ?? null,
      durationMs: row.duration_ms ?? null,
      summary: row.summary ?? null,
    })
  }

  static #holdsARow(parsed: unknown): parsed is MetricsRow {
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  }

  static #messageOf(cause: unknown): string | undefined {
    return (cause as Error).message
  }
}
