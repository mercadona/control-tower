import { ImplementationStep, type ImplementationProgressState } from 'app/implement-progress/ImplementProgress.types'
import type { PlanningActivity } from 'app/planning-progress/PlanningProgress.types'
import type { PlanRefusal, RecoveryAction } from 'app/active-plans/ActivePlan.types'
import type { WorkProgress, WorkReading, WorkSnapshot, WorkExecutionReading } from './WorkProgress.types'

export class WorkProgressContract {
  static object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object')
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
      throw new Error('unexpected work progress fields')
    }
    return record
  }

  static text(value: unknown): string {
    if (typeof value !== 'string') throw new Error('expected text')
    return value
  }

  static count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('expected a non-negative integer')
    return value
  }

  static nullableCount(value: unknown): number | null {
    return value === null ? null : WorkProgressContract.count(value)
  }

  static nullableText(value: unknown): string | null {
    return value === null ? null : WorkProgressContract.text(value)
  }

  static reading<T>(value: unknown, parse: (raw: unknown) => T): WorkReading<T> {
    if (typeof value !== 'object' || value === null || !('kind' in value)) throw new Error('missing reading kind')
    if (value.kind === 'unavailable') {
      const wire = WorkProgressContract.object(value, ['kind', 'detail'])
      return { kind: 'unavailable', detail: WorkProgressContract.text(wire.detail) }
    }
    const wire = WorkProgressContract.object(value, ['kind', 'value'])
    if (wire.kind !== 'available') throw new Error('unknown reading kind')
    return { kind: 'available', value: parse(wire.value) }
  }

  static execution(value: unknown): ImplementationProgressState {
    const wire = WorkProgressContract.object(value, ['step', 'task', 'total_tasks', 'name', 'attempt', 'discards', 'pull_request'])
    const step = Object.values(ImplementationStep).find((candidate) => candidate === wire.step)
    if (step === undefined) throw new Error('unknown execution step')
    let pullRequest = null
    if (wire.pull_request !== null) {
      const pull = WorkProgressContract.object(wire.pull_request, ['number', 'url'])
      pullRequest = { number: WorkProgressContract.count(pull.number), url: WorkProgressContract.text(pull.url) }
    }
    return {
      step, task: WorkProgressContract.nullableCount(wire.task), totalTasks: WorkProgressContract.nullableCount(wire.total_tasks),
      name: WorkProgressContract.nullableText(wire.name), attempt: WorkProgressContract.nullableCount(wire.attempt),
      discards: WorkProgressContract.nullableCount(wire.discards), pullRequest,
    }
  }

  static executionReading(value: unknown): WorkExecutionReading {
    if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'partial') {
      const wire = WorkProgressContract.object(value, ['kind', 'value', 'detail'])
      return { kind: 'partial', value: WorkProgressContract.execution(wire.value), detail: WorkProgressContract.text(wire.detail) }
    }
    return WorkProgressContract.reading(value, WorkProgressContract.execution)
  }

  static activity(value: unknown): PlanningActivity {
    const wire = WorkProgressContract.object(value, ['state', 'running_ms', 'tool_calls', 'last_tool', 'last_text'])
    if (wire.state !== 'running' && wire.state !== 'finished') throw new Error('unknown activity state')
    let lastTool = null
    if (wire.last_tool !== null) {
      const tool = WorkProgressContract.object(wire.last_tool, ['name', 'argument'])
      lastTool = { name: WorkProgressContract.text(tool.name), argument: WorkProgressContract.nullableText(tool.argument) }
    }
    return {
      state: wire.state, runningMs: WorkProgressContract.count(wire.running_ms), toolCalls: WorkProgressContract.count(wire.tool_calls),
      lastTool, lastText: WorkProgressContract.nullableText(wire.last_text),
    }
  }

  static plan(value: unknown): 'writing' | 'ready' {
    if (value !== 'writing' && value !== 'ready') throw new Error('unknown plan state')
    return value
  }

  static refusal(value: unknown): PlanRefusal | null {
    if (value === null) return null
    const wire = WorkProgressContract.object(value, ['state', 'outcome', 'exit', 'task', 'findings', 'verdict'])
    return {
      state: WorkProgressContract.text(wire.state), outcome: WorkProgressContract.text(wire.outcome),
      exit: WorkProgressContract.count(wire.exit), task: WorkProgressContract.nullableCount(wire.task),
      findings: WorkProgressContract.nullableText(wire.findings), verdict: WorkProgressContract.nullableText(wire.verdict),
    }
  }

  static progress(value: unknown): WorkProgress {
    if (typeof value !== 'object' || value === null || !('phase' in value)) throw new Error('missing work phase')
    switch (value.phase) {
      case 'planning': {
        const wire = WorkProgressContract.object(value, ['phase', 'plan', 'activity'])
        return { phase: 'planning', plan: WorkProgressContract.reading(wire.plan, WorkProgressContract.plan), activity: WorkProgressContract.reading(wire.activity, WorkProgressContract.activity) }
      }
      case 'implementing': {
        const wire = WorkProgressContract.object(value, ['phase', 'execution'])
        return { phase: 'implementing', execution: WorkProgressContract.executionReading(wire.execution) }
      }
      case 'uncertain': {
        const wire = WorkProgressContract.object(value, ['phase', 'diagnostic', 'recovery', 'refusal', 'execution'])
        const recovery = WorkProgressContract.object(wire.recovery, ['action', 'detail'])
        const actions: readonly RecoveryAction[] = ['observe', 'continue', 'cleanup', 'inspect']
        const action = actions.find((candidate) => candidate === recovery.action)
        if (action === undefined) throw new Error('unknown recovery action')
        return { phase: 'uncertain', diagnostic: WorkProgressContract.text(wire.diagnostic), recovery: { action, detail: WorkProgressContract.text(recovery.detail) }, refusal: WorkProgressContract.refusal(wire.refusal), execution: WorkProgressContract.executionReading(wire.execution) }
      }
      default:
        throw new Error('unknown work phase')
    }
  }

  static read(value: unknown): WorkSnapshot {
    const wire = WorkProgressContract.object(value, ['repo', 'issue', 'agent', 'progress'])
    return {
      repo: WorkProgressContract.text(wire.repo), issue: WorkProgressContract.count(wire.issue),
      agent: WorkProgressContract.text(wire.agent), progress: WorkProgressContract.progress(wire.progress),
    }
  }
}
