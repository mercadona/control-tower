import type { RecoveryAction } from 'app/active-plans/ActivePlan.types'
import type {
  MilestoneProgressOutcome, SliceAttention, SliceLine, SliceLineState, SliceTask, SliceTaskStatus,
} from 'app/milestone-progress/MilestoneProgress.types'

export class MilestoneProgressClient {
  static readonly PATH = '/milestone-progress'
  static readonly #SLICE_LINE_STATES: readonly SliceLineState[] = ['pending', 'running', 'needs-person', 'delivered']
  static readonly #SLICE_TASK_STATUSES: readonly SliceTaskStatus[] = ['pending', 'running', 'done', 'stopped']
  static readonly #RECOVERY_ACTIONS: readonly RecoveryAction[] = ['observe', 'continue', 'cleanup', 'inspect']

  static async read(): Promise<MilestoneProgressOutcome> {
    try {
      const response = await fetch(MilestoneProgressClient.PATH)
      if (!response.ok) return { kind: 'unavailable' }

      return MilestoneProgressClient.#toOutcome(await response.json())
    } catch {
      return { kind: 'unavailable' }
    }
  }

  static #isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static #isSliceLineState(value: unknown): value is SliceLineState {
    return typeof value === 'string' && MilestoneProgressClient.#SLICE_LINE_STATES.includes(value as SliceLineState)
  }

  static #isSliceTaskStatus(value: unknown): value is SliceTaskStatus {
    return typeof value === 'string' && MilestoneProgressClient.#SLICE_TASK_STATUSES.includes(value as SliceTaskStatus)
  }

  static #isRecoveryAction(value: unknown): value is RecoveryAction {
    return typeof value === 'string' && MilestoneProgressClient.#RECOVERY_ACTIONS.includes(value as RecoveryAction)
  }

  static #isPullRequest(value: unknown): value is { number: number; url: string } {
    return MilestoneProgressClient.#isRecord(value) && typeof value.number === 'number' && typeof value.url === 'string'
  }

  static #isLastTool(value: unknown): value is { name: string; argument: string | null } {
    return MilestoneProgressClient.#isRecord(value) &&
      typeof value.name === 'string' &&
      (value.argument === null || typeof value.argument === 'string')
  }

  static #isSliceAttention(value: unknown): value is SliceAttention {
    if (!MilestoneProgressClient.#isRecord(value)) return false
    if (value.kind === 'veto') {
      return (value.task === null || typeof value.task === 'number') &&
        (value.findings === null || typeof value.findings === 'string') &&
        (value.verdict === null || typeof value.verdict === 'string')
    }
    if (value.kind === 'uncertain') return MilestoneProgressClient.#isRecoveryAction(value.action) && typeof value.detail === 'string'
    if (value.kind === 'partial' || value.kind === 'unreadable') return typeof value.detail === 'string'

    return false
  }

  static #sliceTaskOf(value: unknown): SliceTask | null {
    if (!MilestoneProgressClient.#isRecord(value)) return null
    if (
      typeof value.number !== 'number' ||
      (value.name !== null && typeof value.name !== 'string') ||
      !MilestoneProgressClient.#isSliceTaskStatus(value.status) ||
      (value.ruling !== null && typeof value.ruling !== 'string') ||
      (value.findings !== null && typeof value.findings !== 'string')
    ) return null

    return {
      number: value.number,
      name: value.name as string | null,
      status: value.status,
      ruling: value.ruling as string | null,
      findings: value.findings as string | null,
    }
  }

  static #sliceTasksOf(value: unknown): SliceTask[] | null {
    if (!Array.isArray(value)) return null
    const tasks: SliceTask[] = []
    for (const entry of value) {
      const task = MilestoneProgressClient.#sliceTaskOf(entry)
      if (task === null) return null
      tasks.push(task)
    }

    return tasks
  }

  static #sliceLineOf(value: unknown): SliceLine | null {
    if (!MilestoneProgressClient.#isRecord(value)) return null
    if (
      typeof value.number !== 'number' ||
      typeof value.url !== 'string' ||
      typeof value.title !== 'string' ||
      !MilestoneProgressClient.#isSliceLineState(value.state) ||
      (value.step !== null && typeof value.step !== 'string') ||
      (value.task !== null && typeof value.task !== 'number') ||
      (value.total_tasks !== null && typeof value.total_tasks !== 'number') ||
      (value.step_started_at !== null && typeof value.step_started_at !== 'string') ||
      (value.last_tool !== null && !MilestoneProgressClient.#isLastTool(value.last_tool)) ||
      (value.last_text !== null && typeof value.last_text !== 'string') ||
      (value.pull_request !== null && !MilestoneProgressClient.#isPullRequest(value.pull_request)) ||
      (value.attention !== null && !MilestoneProgressClient.#isSliceAttention(value.attention)) ||
      typeof value.baseline_red !== 'boolean'
    ) return null
    const tasks = MilestoneProgressClient.#sliceTasksOf(value.tasks)
    if (tasks === null) return null

    return {
      number: value.number,
      url: value.url,
      title: value.title,
      state: value.state,
      step: value.step as string | null,
      task: value.task as number | null,
      totalTasks: value.total_tasks as number | null,
      stepStartedAt: value.step_started_at as string | null,
      lastTool: value.last_tool as { name: string; argument: string | null } | null,
      lastText: value.last_text as string | null,
      pullRequest: value.pull_request as { number: number; url: string } | null,
      attention: value.attention as SliceAttention | null,
      baselineRed: value.baseline_red,
      tasks,
    }
  }

  static #sliceLinesOf(value: unknown): SliceLine[] | null {
    if (!Array.isArray(value)) return null
    const lines: SliceLine[] = []
    for (const entry of value) {
      const line = MilestoneProgressClient.#sliceLineOf(entry)
      if (line === null) return null
      lines.push(line)
    }

    return lines
  }

  static #toOutcome(body: unknown): MilestoneProgressOutcome {
    if (!MilestoneProgressClient.#isRecord(body)) return { kind: 'unavailable' }
    if (body.status === 'none') return { kind: 'none' }
    if (body.status === 'no-milestone' && typeof body.target === 'string') return { kind: 'no-milestone', target: body.target }
    if (
      body.status === 'milestone' &&
      typeof body.target === 'string' &&
      typeof body.milestone === 'string' &&
      typeof body.delivered === 'number' &&
      typeof body.total === 'number'
    ) {
      const issues = MilestoneProgressClient.#sliceLinesOf(body.issues)
      if (issues === null) return { kind: 'unavailable' }

      return {
        kind: 'milestone', target: body.target, milestone: body.milestone, delivered: body.delivered, total: body.total, issues,
      }
    }

    return { kind: 'unavailable' }
  }
}
