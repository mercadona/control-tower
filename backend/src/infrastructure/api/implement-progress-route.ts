import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from '../http.ts'
import { Projection } from '../projection.ts'
import { ReadImplementationProgressParams } from '../../application/queries/read-implementation-progress.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../domain/value-objects/repository-name.ts'
import { ImplementationProgressFailure, ImplementationProgressNotRead } from '../../domain/exceptions.ts'
import type { ImplementationState } from '../../domain/value-objects/implementation-state.ts'

export const ProgressRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-root',
  MALFORMED_REPO: 'malformed-progress-repo',
} as const)

export type ProgressRequestOutcomeValue =
  (typeof ProgressRequestOutcome)[keyof typeof ProgressRequestOutcome]

type ProgressAsked = { readonly outcome: unknown }

type ProgressRefusalOf = (asked: ProgressAsked) => Refusal

type ProgressFailureConstructor = new (reason: string) => Error

type ProgressCollapseOf = (cause: Error) => Refusal

type ProgressReading = { readonly state: ImplementationState }

type ImplementationProgressReader = {
  execute(params: ReadImplementationProgressParams): Promise<ProgressReading>,
}

export class ProgressRequest {
  static readonly ROOT_FIELD = 'root'
  static readonly REPO_FIELD = 'repo'

  readonly outcome: ProgressRequestOutcomeValue
  readonly root: CheckoutRoot | null
  readonly issue: number | null
  readonly repository: RepositoryName | null

  constructor({ outcome, root, issue, repository }: {
    outcome: ProgressRequestOutcomeValue,
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
  }): ProgressRequest {
    return new ProgressRequest({ outcome: ProgressRequestOutcome.ACCEPTED, root, issue, repository })
  }

  static refused(outcome: ProgressRequestOutcomeValue): ProgressRequest {
    return new ProgressRequest({ outcome, root: null, issue: null, repository: null })
  }

  static from(rawIssue: unknown, rawRoot: unknown, rawRepo: unknown): ProgressRequest {
    if (!CheckoutRoot.isWellFormed(rawRoot)) {
      return ProgressRequest.refused(ProgressRequestOutcome.MALFORMED_ROOT)
    }
    if (!RepositoryName.isWellFormed(rawRepo)) {
      return ProgressRequest.refused(ProgressRequestOutcome.MALFORMED_REPO)
    }

    return ProgressRequest.accepted({
      root: new CheckoutRoot(rawRoot), issue: Number(rawIssue), repository: new RepositoryName(rawRepo),
    })
  }
}

export class ProgressRefusal {
  static readonly #BY_OUTCOME: Projection<ProgressRefusalOf> = new Projection<ProgressRefusalOf>('refusal', [
    [ProgressRequestOutcome.MALFORMED_ROOT, () => new Refusal({
      status: 400,
      code: ProgressRequestOutcome.MALFORMED_ROOT,
      detail: `${ProgressRequest.ROOT_FIELD} is an absolute path such as ${CheckoutRoot.EXAMPLE}`,
    })],
    [ProgressRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ProgressRequestOutcome.MALFORMED_REPO,
      detail: `${ProgressRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
  ])

  static of(asked: ProgressAsked): Refusal {
    return ProgressRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes(): unknown[] {
    return ProgressRefusal.#BY_OUTCOME.members()
  }
}

export class ProgressCollapse {
  static readonly #STATUS = 400

  static #collapsed(code: string): ProgressCollapseOf {
    return (cause) => new Refusal({ status: ProgressCollapse.#STATUS, code, detail: cause.message })
  }

  static readonly #BY_FAILURE: Projection<ProgressCollapseOf, ProgressFailureConstructor> = new Projection<ProgressCollapseOf, ProgressFailureConstructor>('refusal', [
    [ImplementationProgressNotRead, ProgressCollapse.#collapsed('implementation-progress-not-read')],
  ])

  static of(cause: Error): Refusal {
    return ProgressCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static #declared(): ProgressFailureConstructor[] {
    return ProgressCollapse.#BY_FAILURE.members()
  }

  static declaredFailures(): string[] {
    return ProgressCollapse.#declared().map((failure) => failure.name)
  }

  static declaredCodes(): string[] {
    return ProgressCollapse.#declared().map((failure) => ProgressCollapse.of(new failure('x')).code)
  }
}

export class ImplementProgressRoute {
  static readonly PATH = '/implement-progress/:issue'
  static readonly METHOD = 'GET'

  static handledBy(readImplementationProgress: ImplementationProgressReader): RequestHandler {
    return async (request, response) => {
      const asked = ProgressRequest.from(
        request.params.issue,
        request.query[ProgressRequest.ROOT_FIELD],
        request.query[ProgressRequest.REPO_FIELD]
      )
      if (asked.outcome !== ProgressRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ProgressRefusal.of(asked))
        return
      }
      let read
      try {
        read = await readImplementationProgress.execute(
          new ReadImplementationProgressParams({
            root: asked.root as CheckoutRoot, issue: asked.issue as number, repository: asked.repository as RepositoryName,
          })
        )
      } catch (cause) {
        if (!(cause instanceof ImplementationProgressFailure)) throw cause
        Answer.refuseAs(response, ProgressCollapse.of(cause))
        return
      }
      Answer.send(response, 200, {
        step: read.state.step,
        task: read.state.task,
        total_tasks: read.state.totalTasks,
        name: read.state.name,
        attempt: read.state.attempt,
        discards: read.state.discards,
        pull_request: read.state.pullRequest,
      })
    }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', ImplementProgressRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
