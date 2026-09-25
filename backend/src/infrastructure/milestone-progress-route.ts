import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import { GateCheckout } from './coordinating-sessions.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import {
  ReadMilestoneProgressParams, type MilestoneProgressRead, type ReadMilestoneProgress,
} from '../application/queries/read-milestone-progress.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import type { SliceLine } from '../domain/value-objects/slice-line.ts'
import type { SliceTask } from '../domain/value-objects/slice-task.ts'

export const MilestoneProgressOutcome = Object.freeze({
  NOT_READ: 'milestone-progress-not-read',
} as const)

export class MilestoneProgressRoute {
  static readonly PATH = '/milestone-progress'
  static readonly METHODS = 'GET'

  static reading(held: CoordinatingSessions, read: Pick<ReadMilestoneProgress, 'execute'>): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const current = held.held()
      if (current === null) {
        Answer.send(response, 200, { status: 'none' })
        return
      }
      const reading = new GateCheckout({ conversation: current.conversation, target: current.target })
      let outcome: MilestoneProgressRead
      try {
        outcome = await read.execute(new ReadMilestoneProgressParams({
          root: reading.conversation.root,
          repository: reading.conversation.repository,
          story: reading.conversation.story,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuse(response, 400, MilestoneProgressOutcome.NOT_READ, cause.message)
        return
      }
      if (!held.isCurrentCheckout(reading)) {
        Answer.send(response, 200, { status: 'none' })
        return
      }
      if (outcome.progress === null) {
        Answer.send(response, 200, { status: 'no-milestone', target: reading.target })
        return
      }
      Answer.send(response, 200, {
        status: 'milestone',
        target: reading.target,
        milestone: outcome.progress.milestone,
        delivered: outcome.progress.delivered(),
        total: outcome.progress.lines.length,
        issues: outcome.progress.lines.map(MilestoneProgressRoute.#wireIssueOf),
      })
    }
  }

  static #wireIssueOf(line: SliceLine): object {
    return {
      number: line.issue.number,
      url: line.issue.url,
      title: line.issue.title,
      state: line.state,
      step: line.step,
      task: line.task,
      total_tasks: line.totalTasks,
      step_started_at: line.stepStartedAt,
      last_tool: line.lastToolCall === null ? null : { name: line.lastToolCall.name, argument: line.lastToolCall.argument },
      last_text: line.lastText,
      pull_request: line.pullRequest,
      attention: line.attention,
      baseline_red: line.baselineRed,
      tasks: line.tasks.map(MilestoneProgressRoute.#wireTaskOf),
    }
  }

  static #wireTaskOf(task: SliceTask): object {
    return { number: task.number, name: task.name, status: task.status, ruling: task.ruling, findings: task.findings }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', MilestoneProgressRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
