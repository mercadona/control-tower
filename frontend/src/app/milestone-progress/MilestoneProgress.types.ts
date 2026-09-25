import type { RecoveryAction } from 'app/active-plans/ActivePlan.types'

export type SliceLineState = 'pending' | 'running' | 'needs-person' | 'delivered'

export type SliceTaskStatus = 'pending' | 'running' | 'done' | 'stopped'

export type SliceAttention =
  | { kind: 'veto'; task: number | null; findings: string | null; verdict: string | null }
  | { kind: 'uncertain'; action: RecoveryAction; detail: string }
  | { kind: 'partial'; detail: string }
  | { kind: 'unreadable'; detail: string }

export type SliceTask = {
  number: number
  name: string | null
  status: SliceTaskStatus
  ruling: string | null
  findings: string | null
}

export type SliceLine = {
  number: number
  url: string
  title: string
  state: SliceLineState
  step: string | null
  task: number | null
  totalTasks: number | null
  stepStartedAt: string | null
  lastTool: { name: string; argument: string | null } | null
  lastText: string | null
  pullRequest: { number: number; url: string } | null
  attention: SliceAttention | null
  baselineRed: boolean
  tasks: SliceTask[]
}

export type MilestoneProgressOutcome =
  | { kind: 'none' }
  | { kind: 'no-milestone'; target: string }
  | { kind: 'milestone'; target: string; milestone: string; delivered: number; total: number; issues: SliceLine[] }
  | { kind: 'unavailable' }
