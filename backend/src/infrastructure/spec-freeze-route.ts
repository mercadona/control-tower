import type { Request, RequestHandler, Response } from 'express'
import { Answer, Refusal } from './http.ts'
import { Projection } from './projection.ts'
import { SpecFreezeState, ReadSpecFreezeParams } from '../application/queries/read-spec-freeze.ts'
import { GateKey } from './gate-key.ts'
import { FreezeSpec, FreezeSpecParams, FreezeOutcome } from '../application/actions/freeze-spec.ts'
import { PlanFailure } from '../domain/exceptions.ts'
import { PlanCollapse } from './start-plan-route.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { ReadSpecFreeze, SpecFreezeRead } from '../application/queries/read-spec-freeze.ts'
import type { FreezeFinding } from '../domain/value-objects/freeze-finding.ts'
import type { SpecFrozen, FreezeOutcomeValue } from '../application/actions/freeze-spec.ts'

type WireFinding = { readonly code: string, readonly line: number | null, readonly detail: string | null }

export const SpecFreezeOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session',
  NO_EPIC_SPEC: 'no-epic-spec',
  SPEC_ALREADY_FROZEN: 'spec-already-frozen',
  SPEC_NOT_FREEZABLE: 'spec-not-freezable',
} as const)

export type SpecFreezeOutcomeValue = (typeof SpecFreezeOutcome)[keyof typeof SpecFreezeOutcome]

type SpecFreezeRefusalOf = (frozen: SpecFrozen) => Refusal

export class SpecFreezeRefusal {
  static readonly #STATUS = 400
  static readonly #NO_EPIC_SPEC_DETAIL = 'no execution spec exists in this checkout to freeze'
  static readonly #SPEC_ALREADY_FROZEN_DETAIL = 'the spec is already frozen: it cannot be frozen twice'

  static readonly #BY_OUTCOME: Projection<SpecFreezeRefusalOf, FreezeOutcomeValue> =
    new Projection<SpecFreezeRefusalOf, FreezeOutcomeValue>('refusal', [
      [FreezeOutcome.NO_SPEC, () => new Refusal({
        status: SpecFreezeRefusal.#STATUS,
        code: SpecFreezeOutcome.NO_EPIC_SPEC,
        detail: SpecFreezeRefusal.#NO_EPIC_SPEC_DETAIL,
      })],
      [FreezeOutcome.ALREADY_FROZEN, () => new Refusal({
        status: SpecFreezeRefusal.#STATUS,
        code: SpecFreezeOutcome.SPEC_ALREADY_FROZEN,
        detail: SpecFreezeRefusal.#SPEC_ALREADY_FROZEN_DETAIL,
      })],
      [FreezeOutcome.NOT_FREEZABLE, (frozen) => new Refusal({
        status: SpecFreezeRefusal.#STATUS,
        code: SpecFreezeOutcome.SPEC_NOT_FREEZABLE,
        detail: SpecFreezeRefusal.#notFreezableDetail(frozen.findings),
      })],
    ])

  static of(frozen: SpecFrozen): Refusal {
    return SpecFreezeRefusal.#BY_OUTCOME.of(frozen.outcome)(frozen)
  }

  static #notFreezableDetail(findings: readonly FreezeFinding[]): string {
    const [first] = findings
    const where = first.line === null ? `the first is ${first.code}` : `the first on line ${first.line}`

    return `the spec is not freezable: ${findings.length} finding(s) remain, ${where}`
  }
}

export class SpecFreezeRoute {
  static readonly PATH = '/spec-freeze'
  static readonly METHODS = 'GET, POST'
  static readonly #NOT_FROM_THE_PAGE_DETAIL = 'gate 1 answers only a request carrying the key the page was given'
  static readonly #NO_COORDINATING_SESSION_DETAIL = 'no coordinating session is held: there is nothing to freeze'

  static reading(held: CoordinatingSessions, read: ReadSpecFreeze, key: GateKey): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      const holding = held.held()
      if (holding === null) {
        Answer.send(response, 200, { status: 'none' })
        return
      }
      const outcome = await read.execute(new ReadSpecFreezeParams({
        root: holding.conversation.root,
        repository: holding.conversation.repository,
      }))
      const minted = key.forThePage({
        origin: request.get('Origin'),
        host: request.get('Host'),
        site: request.get(GateKey.SITE_HEADER),
      })
      SpecFreezeRoute.#answerRead(response, outcome, minted)
    }
  }

  static freezing(held: CoordinatingSessions, freeze: FreezeSpec, key: GateKey): RequestHandler {
    return async (request: Request, response: Response): Promise<void> => {
      if (!key.holds(request.get(GateKey.HEADER))) {
        Answer.refuse(response, 403, SpecFreezeOutcome.NOT_FROM_THE_PAGE, SpecFreezeRoute.#NOT_FROM_THE_PAGE_DETAIL)
        return
      }
      const holding = held.held()
      if (holding === null) {
        Answer.refuse(response, 400, SpecFreezeOutcome.NO_COORDINATING_SESSION, SpecFreezeRoute.#NO_COORDINATING_SESSION_DETAIL)
        return
      }
      let frozen: SpecFrozen
      try {
        frozen = await freeze.execute(new FreezeSpecParams({
          root: holding.conversation.root,
          repository: holding.conversation.repository,
        }))
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        Answer.refuseAs(response, PlanCollapse.of(cause))
        return
      }
      if (frozen.outcome !== FreezeOutcome.FROZEN) {
        Answer.refuseAs(response, SpecFreezeRefusal.of(frozen))
        return
      }
      Answer.send(response, 200, {
        status: SpecFreezeState.FROZEN,
        on: frozen.on,
        pullRequest: frozen.pullRequest,
      })
    }
  }

  static #answerRead(response: Response, outcome: SpecFreezeRead, minted: string | null): void {
    switch (outcome.state) {
      case SpecFreezeState.NO_SPEC:
        Answer.send(response, 200, { status: SpecFreezeState.NO_SPEC })
        return
      case SpecFreezeState.DRAFT:
        Answer.send(response, 200, {
          status: SpecFreezeState.DRAFT,
          spec: outcome.spec!.path,
          findings: outcome.findings.map(SpecFreezeRoute.#wireFindingOf),
          ...(minted === null ? {} : { key: minted }),
        })
        return
      case SpecFreezeState.FROZEN:
        Answer.send(response, 200, {
          status: SpecFreezeState.FROZEN,
          spec: outcome.spec!.path,
          on: outcome.frozenOn,
          pullRequest: outcome.pullRequest,
        })
        return
      default: {
        const exhaustive: never = outcome.state
        throw new Error(`no spec freeze answer declared for ${exhaustive}`)
      }
    }
  }

  static #wireFindingOf(finding: FreezeFinding): WireFinding {
    return { code: finding.code, line: finding.line, detail: finding.detail }
  }

  static refuseOtherMethods(request: Request, response: Response): void {
    response.setHeader('Allow', SpecFreezeRoute.METHODS)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
