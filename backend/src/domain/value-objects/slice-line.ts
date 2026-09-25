import type { EpicIssue } from './epic-issue.ts'
import type { PlanningToolCall } from './planning-activity.ts'
import type { SliceTask } from './slice-task.ts'

export const SliceLineState = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  NEEDS_PERSON: 'needs-person',
  DELIVERED: 'delivered',
} as const)

export type SliceLineStateValue = (typeof SliceLineState)[keyof typeof SliceLineState]

export type SliceAttention =
  | { readonly kind: 'veto', readonly task: number | null, readonly findings: string | null, readonly verdict: string | null }
  | { readonly kind: 'controls', readonly task: number | null, readonly outcome: string,
      readonly command: string | null, readonly code: number | null, readonly log: string | null }
  | { readonly kind: 'global', readonly outcome: string,
      readonly command: string | null, readonly code: number | null, readonly log: string | null }
  | { readonly kind: 'uncertain', readonly action: 'observe' | 'continue' | 'cleanup' | 'inspect', readonly detail: string }
  | { readonly kind: 'partial', readonly detail: string }
  | { readonly kind: 'unreadable', readonly detail: string }

type ReviewedPullRequest = { readonly number: number, readonly url: string }

export class SliceLine {
  static readonly PLAN_STEP = 'planning'

  readonly issue: EpicIssue
  readonly state: SliceLineStateValue
  readonly step: string | null
  readonly task: number | null
  readonly totalTasks: number | null
  readonly stepStartedAt: string | null
  readonly lastToolCall: PlanningToolCall | null
  readonly lastText: string | null
  readonly pullRequest: ReviewedPullRequest | null
  readonly baselineRed: boolean
  readonly attention: SliceAttention | null
  readonly tasks: readonly SliceTask[]

  constructor(asked: {
    issue: EpicIssue,
    state: SliceLineStateValue,
    step: string | null,
    task: number | null,
    totalTasks: number | null,
    stepStartedAt: string | null,
    lastToolCall: PlanningToolCall | null,
    lastText: string | null,
    pullRequest: ReviewedPullRequest | null,
    baselineRed: boolean,
    attention: SliceAttention | null,
    tasks: readonly SliceTask[],
  }) {
    this.issue = asked.issue
    this.state = asked.state
    this.step = asked.step
    this.task = asked.task
    this.totalTasks = asked.totalTasks
    this.stepStartedAt = asked.stepStartedAt
    this.lastToolCall = asked.lastToolCall
    this.lastText = asked.lastText
    this.pullRequest = asked.pullRequest
    this.baselineRed = asked.baselineRed
    this.attention = asked.attention
    this.tasks = Object.freeze([...asked.tasks])
    Object.freeze(this)
  }
}
