import { ImplementationStep } from './implementation-state.ts'
import type { ImplementationState } from './implementation-state.ts'
import type { ImplementationHistoryEntry } from './implementation-history-entry.ts'
import type { RunClosure } from './run-instruction.ts'

export const SliceTaskStatus = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  STOPPED: 'stopped',
} as const)

export type SliceTaskStatusValue = (typeof SliceTaskStatus)[keyof typeof SliceTaskStatus]

export class SliceTask {
  readonly number: number
  readonly name: string | null
  readonly status: SliceTaskStatusValue
  readonly ruling: string | null
  readonly findings: string | null

  constructor(asked: {
    number: number,
    name: string | null,
    status: SliceTaskStatusValue,
    ruling: string | null,
    findings: string | null,
  }) {
    this.number = asked.number
    this.name = asked.name
    this.status = asked.status
    this.ruling = asked.ruling
    this.findings = asked.findings
    Object.freeze(this)
  }

  static listOf({ state, entries, veto }: {
    state: ImplementationState | null, entries: readonly ImplementationHistoryEntry[], veto: RunClosure | null,
  }): readonly SliceTask[] {
    if (state === null) return []
    const totalTasks = state.totalTasks ?? 0
    const tasks: SliceTask[] = []
    for (let number = 1; number <= totalTasks; number += 1) {
      tasks.push(SliceTask.#taskFor(number, state, entries, veto))
    }

    return tasks
  }

  static #taskFor(
    number: number,
    state: ImplementationState,
    entries: readonly ImplementationHistoryEntry[],
    veto: RunClosure | null,
  ): SliceTask {
    const ofTask = entries.filter((entry) => entry.task === number)
    const status = SliceTask.#statusOf(number, state, veto)

    return new SliceTask({
      number,
      name: SliceTask.#latestNonNull(ofTask, (entry) => entry.taskName) ?? (number === state.task ? state.name : null),
      status,
      ruling: SliceTask.#latestNonNull(ofTask, (entry) => entry.ruling),
      findings: status === SliceTaskStatus.STOPPED ? veto!.findings : null,
    })
  }

  static #statusOf(number: number, state: ImplementationState, veto: RunClosure | null): SliceTaskStatusValue {
    if (veto !== null && veto.task === number) return SliceTaskStatus.STOPPED
    if (state.task === number) return SliceTaskStatus.RUNNING
    if (state.task !== null && number < state.task) return SliceTaskStatus.DONE
    if (state.task === null && state.step !== ImplementationStep.STARTING) return SliceTaskStatus.DONE

    return SliceTaskStatus.PENDING
  }

  static #latestNonNull(
    entries: readonly ImplementationHistoryEntry[], field: (entry: ImplementationHistoryEntry) => string | null,
  ): string | null {
    let winner: { value: string, writtenAt: string | null } | null = null
    for (const entry of entries) {
      const value = field(entry)
      if (value === null) continue
      if (winner === null || SliceTask.#isLater(entry.writtenAt, winner.writtenAt)) {
        winner = { value, writtenAt: entry.writtenAt }
      }
    }

    return winner?.value ?? null
  }

  static #isLater(candidate: string | null, current: string | null): boolean {
    if (current === null) return true
    if (candidate === null) return false

    return Date.parse(candidate) > Date.parse(current)
  }
}
