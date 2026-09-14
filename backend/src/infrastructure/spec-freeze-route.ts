import type { Request, RequestHandler, Response } from 'express'
import { Answer } from './http.ts'
import { SpecFreezeState, ReadSpecFreezeParams } from '../application/queries/read-spec-freeze.ts'
import type { GateKey } from './gate-key.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { ReadSpecFreeze, SpecFreezeRead } from '../application/queries/read-spec-freeze.ts'
import type { FreezeFinding } from '../domain/value-objects/freeze-finding.ts'

type WireFinding = { readonly code: string, readonly line: number | null, readonly detail: string | null }

export class SpecFreezeRoute {
  static readonly PATH = '/spec-freeze'
  static readonly METHODS = 'GET, POST'

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
      const minted = key.forThePage({ origin: request.get('Origin'), host: request.get('Host') })
      SpecFreezeRoute.#answerRead(response, outcome, minted)
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
