import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { PlanStateValue } from '../domain/value-objects/plan-state.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'

type WatchedPlan = { issue: number, repository: RepositoryName }

type ReadProgress = { state: PlanStateValue }

type AskedOutcome = { outcome: unknown }

type AcceptedEventsRequest = EventsRequest & { readonly watched: PlanWatch }

export class PlanSessions {
  readonly live: Map<string, PlanWatch>

  constructor() {
    this.live = new Map()
  }

  static #keyFor(repository: RepositoryName, issueNumber: number): string {
    return `${repository.text}#${issueNumber}`
  }

  remember(watch: PlanWatch): void {
    this.live.set(PlanSessions.#keyFor(watch.repository, watch.issue.number), watch)
  }

  find({ issue, repository }: WatchedPlan): PlanWatch | null {
    return this.live.get(PlanSessions.#keyFor(repository, issue)) ?? null
  }

  known(): PlanWatch[] {
    return [...this.live.values()]
  }

  forget({ issue, repository }: WatchedPlan): void {
    this.live.delete(PlanSessions.#keyFor(repository, issue))
  }
}

export const EventsRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ISSUE: 'malformed-watched-issue',
  MALFORMED_REPO: 'malformed-repo',
  NOT_WATCHED: 'not-watched',
} as const)

export type EventsRequestOutcomeValue = (typeof EventsRequestOutcome)[keyof typeof EventsRequestOutcome]

export class EventsRequest {
  static readonly EXAMPLE = 42
  static readonly REPO_FIELD = 'repo'
  static readonly #NUMBERED = /^[1-9][0-9]*$/

  readonly outcome: EventsRequestOutcomeValue
  readonly watched: PlanWatch | null

  constructor({ outcome, watched }: { outcome: EventsRequestOutcomeValue, watched: PlanWatch | null }) {
    this.outcome = outcome
    this.watched = watched
    Object.freeze(this)
  }

  static accepted(watched: PlanWatch): EventsRequest {
    return new EventsRequest({ outcome: EventsRequestOutcome.ACCEPTED, watched })
  }

  static refused(outcome: EventsRequestOutcomeValue): EventsRequest {
    return new EventsRequest({ outcome, watched: null })
  }

  static isAccepted(asked: EventsRequest): asked is AcceptedEventsRequest {
    return asked.outcome === EventsRequestOutcome.ACCEPTED
  }

  static from(rawIssue: unknown, rawRepo: unknown, sessions: PlanSessions): EventsRequest {
    if (typeof rawIssue !== 'string' || !EventsRequest.#NUMBERED.test(rawIssue)) {
      return EventsRequest.refused(EventsRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(rawRepo)) {
      return EventsRequest.refused(EventsRequestOutcome.MALFORMED_REPO)
    }
    const watched = sessions.find({ repository: new RepositoryName(rawRepo), issue: Number(rawIssue) })
    if (watched === null) {
      return EventsRequest.refused(EventsRequestOutcome.NOT_WATCHED)
    }

    return EventsRequest.accepted(watched)
  }
}

export class EventsRefusal {
  static readonly NOT_WATCHED = 'no plan was started for that issue'
  static readonly #BY_OUTCOME: Projection<(asked: AskedOutcome) => Refusal>
    = new Projection<(asked: AskedOutcome) => Refusal>('refusal', [
      [EventsRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
        status: 400,
        code: EventsRequestOutcome.MALFORMED_ISSUE,
        detail: `the issue to watch is a number such as ${EventsRequest.EXAMPLE}`,
      })],
      [EventsRequestOutcome.MALFORMED_REPO, () => new Refusal({
        status: 400,
        code: EventsRequestOutcome.MALFORMED_REPO,
        detail: `${EventsRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
      })],
      [EventsRequestOutcome.NOT_WATCHED, () => new Refusal({
        status: 400,
        code: EventsRequestOutcome.NOT_WATCHED,
        detail: EventsRefusal.NOT_WATCHED,
      })],
    ])

  static of(asked: AskedOutcome): Refusal {
    return EventsRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return EventsRefusal.#BY_OUTCOME.members()
  }
}

export class PlanEvents {
  readonly read: (session: PlanWatch) => Promise<ReadProgress>
  readonly sleep: () => Promise<void>

  constructor({ read, sleep }: {
    read: (session: PlanWatch) => Promise<ReadProgress>,
    sleep: () => Promise<void>,
  }) {
    this.read = read
    this.sleep = sleep
  }

  static readonly ERROR_EVENT = 'error'
  static readonly PROGRESS_NOT_READ = 'plan-progress-not-read'

  static frameFor(state: PlanStateValue): string {
    return `data: ${JSON.stringify({ state })}\n\n`
  }

  static failureFrameFor(cause: Error, code: string): string {
    return `event: ${PlanEvents.ERROR_EVENT}\ndata: ${JSON.stringify({ code, detail: cause.message })}\n\n`
  }

  async *stream(session: PlanWatch, cancelled: () => boolean): AsyncGenerator<string> {
    let last: PlanStateValue | null = null
    for (;;) {
      let read: ReadProgress | null = null
      try {
        read = await this.read(session)
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        yield PlanEvents.failureFrameFor(cause, PlanEvents.PROGRESS_NOT_READ)
      }
      if (read !== null && read.state !== last) {
        last = read.state
        yield PlanEvents.frameFor(read.state)
      }
      await this.sleep()
      if (cancelled()) return
    }
  }
}

class Disconnection {
  static watch(request: Request): () => boolean {
    let happened = false
    request.on('close', () => {
      happened = true
    })

    return () => happened
  }
}

export class PlanEventsRoute {
  static readonly PATH = '/plan-events/:issue'
  static readonly METHOD = 'GET'
  static readonly #HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  static #ignore(): void {}

  static handledBy(sessions: PlanSessions, events: PlanEvents): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const asked = EventsRequest.from(request.params.issue, request.query[EventsRequest.REPO_FIELD], sessions)
      if (!EventsRequest.isAccepted(asked)) {
        Answer.refuseAs(response, EventsRefusal.of(asked))
        return
      }
      const disconnected = Disconnection.watch(request)
      response.on('error', PlanEventsRoute.#ignore)
      response.writeHead(200, PlanEventsRoute.#HEADERS)
      for await (const frame of events.stream(asked.watched, disconnected)) {
        response.write(frame)
      }
      response.end()
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', PlanEventsRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
