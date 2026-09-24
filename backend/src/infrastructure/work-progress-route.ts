import type { Request, RequestHandler, Response } from 'express'
import { ReadWorkProgressParams, type ReadWorkProgress, type ReadWorkProgressResult } from '../application/queries/read-work-progress.ts'
import { WorkNotFound, WorkNotRead, WorkNotUnderstood, WorkProgressFailure } from '../domain/exceptions.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { WorkProgressDetail, WorkReading } from '../domain/value-objects/work-progress.ts'
import type { ImplementationState } from '../domain/value-objects/implementation-state.ts'
import { Answer, Refusal } from './http.ts'

export class WorkProgressResponse {
  static of(result: ReadWorkProgressResult): object {
    const { watch, detail } = result.progress
    return {
      repo: watch.repository.text,
      issue: watch.issue.number,
      agent: watch.agent,
      progress: WorkProgressResponse.#detail(detail),
    }
  }

  static #reading<T>(reading: WorkReading<T> | { kind: 'partial', value: T, detail: string }, project: (value: T) => unknown): object {
    if (reading.kind === 'partial') return { kind: 'partial', value: project(reading.value), detail: reading.detail }
    return reading.kind === 'available'
      ? { kind: 'available', value: project(reading.value) }
      : { kind: 'unavailable', detail: reading.detail }
  }

  static #detail(detail: WorkProgressDetail): object {
    switch (detail.phase) {
      case 'planning':
        return {
          phase: 'planning',
          plan: WorkProgressResponse.#reading(detail.plan, (value) => value),
          activity: WorkProgressResponse.#reading(detail.activity, (activity) => ({
            state: activity.state, running_ms: activity.runningMs, tool_calls: activity.toolCalls,
            last_tool: activity.lastToolCall === null ? null : {
              name: activity.lastToolCall.name, argument: activity.lastToolCall.argument,
            },
            last_text: activity.lastText,
          })),
        }
      case 'implementing':
        return {
          phase: 'implementing',
          execution: WorkProgressResponse.#reading(detail.execution, WorkProgressResponse.#execution),
        }
      case 'uncertain':
        return {
          phase: 'uncertain', diagnostic: detail.diagnostic,
          execution: WorkProgressResponse.#reading(detail.execution, WorkProgressResponse.#execution),
          recovery: { action: detail.recovery.action, detail: detail.recovery.detail },
          refusal: detail.refusal === null ? null : {
            state: detail.refusal.state, outcome: detail.refusal.outcome, exit: detail.refusal.exit,
            task: detail.refusal.task, findings: detail.refusal.findings, verdict: detail.refusal.verdict,
          },
        }
    }
  }

  static #execution(state: ImplementationState): object {
    return {
      step: state.step, task: state.task, total_tasks: state.totalTasks,
      name: state.name, attempt: state.attempt, discards: state.discards, pull_request: state.pullRequest,
    }
  }
}

export class WorkProgressRoute {
  static readonly CODES = Object.freeze({
    MALFORMED_ISSUE: 'malformed-work-issue',
    MALFORMED_REPO: 'malformed-work-repo',
    UNKNOWN_FIELD: 'unknown-work-field',
    NOT_FOUND: 'work-not-found',
    NOT_READ: 'work-not-read',
    NOT_UNDERSTOOD: 'work-not-understood',
  })
  static readonly PATH = '/work-progress/:issue'
  static readonly METHOD = 'GET'
  static readonly #NUMBERED = /^[1-9][0-9]*$/

  static handledBy(reader: Pick<ReadWorkProgress, 'execute'>): RequestHandler {
    return async (request, response) => {
      const issue = request.params.issue
      if (typeof issue !== 'string' || !WorkProgressRoute.#NUMBERED.test(issue) || !Number.isSafeInteger(Number(issue))) {
        Answer.refuse(response, 400, WorkProgressRoute.CODES.MALFORMED_ISSUE, 'issue must be a positive safe integer')
        return
      }
      if (!RepositoryName.isWellFormed(request.query.repo)) {
        Answer.refuse(response, 400, WorkProgressRoute.CODES.MALFORMED_REPO, 'repo must be a repository such as owner/name')
        return
      }
      if (Object.keys(request.query).some((key) => key !== 'repo')) {
        Answer.refuse(response, 400, WorkProgressRoute.CODES.UNKNOWN_FIELD, 'only repo is accepted in the query')
        return
      }
      try {
        const result = await reader.execute(new ReadWorkProgressParams(Number(issue), new RepositoryName(request.query.repo)))
        Answer.send(response, 200, WorkProgressResponse.of(result))
      } catch (cause) {
        if (!(cause instanceof WorkProgressFailure)) throw cause
        Answer.refuseAs(response, WorkProgressRoute.#failure(cause))
      }
    }
  }

  static #failure(cause: WorkProgressFailure): Refusal {
    if (cause instanceof WorkNotFound) return new Refusal({ status: 400, code: WorkProgressRoute.CODES.NOT_FOUND, detail: cause.message })
    if (cause instanceof WorkNotRead) return new Refusal({ status: 400, code: WorkProgressRoute.CODES.NOT_READ, detail: cause.message })
    if (cause instanceof WorkNotUnderstood) return new Refusal({ status: 400, code: WorkProgressRoute.CODES.NOT_UNDERSTOOD, detail: cause.message })
    throw cause
  }

  static refuseOtherMethods(_request: Request, response: Response): void {
    response.setHeader('Allow', WorkProgressRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
