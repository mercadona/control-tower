import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { ReadImplementationHistoryParams } from '../application/queries/read-implementation-history.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { ImplementationHistoryFailure, ImplementationHistoryNotRead } from '../domain/exceptions.ts'
import type { ImplementationHistoryEntry } from '../domain/value-objects/implementation-history-entry.ts'

export const HistoryRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-root',
  MALFORMED_REPO: 'malformed-history-repo',
} as const)

export type HistoryRequestOutcomeValue = (typeof HistoryRequestOutcome)[keyof typeof HistoryRequestOutcome]

type HistoryAsked = { readonly outcome: unknown }

type HistoryRefusalOf = (asked: HistoryAsked) => Refusal

type HistoryFailureConstructor = new (reason: string) => Error

type HistoryCollapseOf = (cause: Error) => Refusal

type HistoryReading = { readonly entries: ImplementationHistoryEntry[] }

type ImplementationHistoryReader = {
  execute(params: ReadImplementationHistoryParams): Promise<HistoryReading>,
}

export class HistoryRequest {
  static readonly ROOT_FIELD = 'root'
  static readonly REPO_FIELD = 'repo'

  readonly outcome: HistoryRequestOutcomeValue
  readonly root: CheckoutRoot | null
  readonly issue: number | null
  readonly repository: RepositoryName | null

  constructor({ outcome, root, issue, repository }: {
    outcome: HistoryRequestOutcomeValue,
    root: CheckoutRoot | null,
    issue: number | null,
    repository: RepositoryName | null,
  }) {
    this.outcome = outcome
    this.root = root
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }

  static accepted({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository: RepositoryName,
  }): HistoryRequest {
    return new HistoryRequest({ outcome: HistoryRequestOutcome.ACCEPTED, root, issue, repository })
  }

  static refused(outcome: HistoryRequestOutcomeValue): HistoryRequest {
    return new HistoryRequest({ outcome, root: null, issue: null, repository: null })
  }

  static from(rawIssue: unknown, rawRoot: unknown, rawRepo: unknown): HistoryRequest {
    if (!CheckoutRoot.isWellFormed(rawRoot)) {
      return HistoryRequest.refused(HistoryRequestOutcome.MALFORMED_ROOT)
    }
    if (!RepositoryName.isWellFormed(rawRepo)) {
      return HistoryRequest.refused(HistoryRequestOutcome.MALFORMED_REPO)
    }

    return HistoryRequest.accepted({
      root: new CheckoutRoot(rawRoot), issue: Number(rawIssue), repository: new RepositoryName(rawRepo),
    })
  }
}

export class HistoryRefusal {
  static readonly #BY_OUTCOME: Projection<HistoryRefusalOf> = new Projection<HistoryRefusalOf>('refusal', [
    [HistoryRequestOutcome.MALFORMED_ROOT, () => new Refusal({
      status: 400,
      code: HistoryRequestOutcome.MALFORMED_ROOT,
      detail: `${HistoryRequest.ROOT_FIELD} is an absolute path such as ${CheckoutRoot.EXAMPLE}`,
    })],
    [HistoryRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: HistoryRequestOutcome.MALFORMED_REPO,
      detail: `${HistoryRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
  ])

  static of(asked: HistoryAsked): Refusal {
    return HistoryRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return HistoryRefusal.#BY_OUTCOME.members()
  }
}

export class HistoryCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): HistoryCollapseOf {
    return (cause) => new Refusal({ status: HistoryCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<HistoryCollapseOf, HistoryFailureConstructor> = new Projection<HistoryCollapseOf, HistoryFailureConstructor>('refusal', [
    [ImplementationHistoryNotRead, HistoryCollapse.#collapsed('implementation-history-not-read')],
  ])

  static of(cause: Error): Refusal {
    return HistoryCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): HistoryFailureConstructor[] {
    return HistoryCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return HistoryCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return HistoryCollapse.#declared().map((failure) => HistoryCollapse.of(new failure('x')).code)
  }
}

class HistoryEntryOnTheWire {
  static of(entry: ImplementationHistoryEntry): unknown {
    return {
      step: entry.step,
      task: entry.task,
      task_name: entry.taskName,
      tasks_total: entry.tasksTotal,
      attempt: entry.attempt,
      outcome: entry.outcome,
      written_at: entry.writtenAt,
      duration_ms: entry.durationMs,
      summary: entry.summary,
    }
  }
}

export class ImplementHistoryRoute {
  static readonly PATH = '/implement-history/:issue'
  static readonly METHOD = 'GET'

  static handledBy(readImplementationHistory: ImplementationHistoryReader): RequestHandler {
    return async (request, response) => {
      const asked = HistoryRequest.from(
        request.params.issue,
        request.query[HistoryRequest.ROOT_FIELD],
        request.query[HistoryRequest.REPO_FIELD]
      )
      if (asked.outcome !== HistoryRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, HistoryRefusal.of(asked))
        return
      }
      let read
      try {
        read = await readImplementationHistory.execute(
          new ReadImplementationHistoryParams({
            root: asked.root as CheckoutRoot, issue: asked.issue as number, repository: asked.repository as RepositoryName,
          })
        )
      } catch (cause) {
        if (!(cause instanceof ImplementationHistoryFailure)) throw cause
        Answer.refuseAs(response, HistoryCollapse.of(cause))
        return
      }
      Answer.send(response, 200, { steps: read.entries.map((entry) => HistoryEntryOnTheWire.of(entry)) })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ImplementHistoryRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
