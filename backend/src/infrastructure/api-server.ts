import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Answer, Route, Browsers, JsonBody } from './http.ts'
import { StartPlanRoute } from './start-plan-route.ts'
import { ImplementPlanRoute } from './implement-plan-route.ts'
import { PlanEventsRoute } from './plan-events-route.ts'
import { ActivePlansRoute } from './active-plans-route.ts'
import { ImplementProgressRoute } from './implement-progress-route.ts'
import { ImplementHistoryRoute } from './implement-history-route.ts'
import { ExternalToolsRoute } from './external-tools-route.ts'
import type { StartPlan } from '../application/actions/start-plan.ts'
import type { ImplementPlanParams } from '../application/actions/implement-plan.ts'
import type { ReadImplementationProgressParams } from '../application/queries/read-implementation-progress.ts'
import type { ReadImplementationHistoryParams } from '../application/queries/read-implementation-history.ts'
import type { SurveyExternalTools } from '../application/queries/survey-external-tools.ts'
import type { PlanEvents, PlanSessions } from './plan-events-route.ts'
import type { ActivePlans, ActivePlanRecovering } from './active-plans-route.ts'
import type { ImplementationState } from '../domain/value-objects/implementation-state.ts'
import type { ImplementationHistoryEntry } from '../domain/value-objects/implementation-history-entry.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'

export const LOOPBACK = '127.0.0.1'

type PlanImplementer = { execute(params: ImplementPlanParams): Promise<void> }

type PullRequestReviews = { start(watch: PlanWatch): void }

type ImplementationStarts = { remember(watch: PlanWatch): Promise<void> }

type ImplementationProgressReader = {
  execute(params: ReadImplementationProgressParams): Promise<{ readonly state: ImplementationState }>,
}

type ImplementationHistoryReader = {
  execute(params: ReadImplementationHistoryParams): Promise<{ readonly entries: ImplementationHistoryEntry[] }>,
}

type Stderr = (line: string) => void

type RequestFailure = {
  readonly type?: unknown,
  readonly status?: unknown,
  readonly stack?: unknown,
  readonly message?: unknown,
}

export type ApiCollaborators = {
  port: number,
  startPlan?: StartPlan | null,
  implementPlan?: PlanImplementer | null,
  implementProgress?: ImplementationProgressReader | null,
  implementHistory?: ImplementationHistoryReader | null,
  pullRequestReviews?: PullRequestReviews | null,
  planEvents?: PlanEvents | null,
  sessions?: PlanSessions | null,
  activePlans?: ActivePlans | null,
  externalTools?: SurveyExternalTools | null,
  implementationStarts?: ImplementationStarts | null,
  recovery?: ActivePlanRecovering | null,
  stderr?: Stderr | null,
  frontendRoot: string,
}

class FrontendPages {
  static mountedOn(app: Express, root: string): void {
    if (!existsSync(root)) return
    app.use(express.static(root, { index: 'index.html', redirect: false, fallthrough: true }))
  }
}
class Failures {
  static nothingMatched(request: Request, response: Response): void {
    Answer.refuse(response, 404, 'not-found', 'not found')
  }

  static answer(cause: RequestFailure, request: Request, response: Response, next: NextFunction): void {
    if (JsonBody.isOverflow(cause)) {
      Answer.refuseAs(response, JsonBody.overflowRefusal())
      return
    }
    if (cause.status === undefined) {
      process.stderr.write(`request to ${request.originalUrl} failed: ${cause.stack ?? cause.message}\n`)
    }
    if (response.headersSent || response.writableEnded) {
      request.destroy()
      response.destroy()
      return
    }
    response.once('finish', () => request.destroy())
    Answer.refuse(response, 400, 'request-failed', 'request failed')
  }
}

export class ApiServer {
  readonly requestedPort: number
  readonly startPlan: StartPlan | null | undefined
  readonly implementPlan: PlanImplementer | null | undefined
  readonly implementProgress: ImplementationProgressReader | null | undefined
  readonly implementHistory: ImplementationHistoryReader | null | undefined
  readonly pullRequestReviews: PullRequestReviews | null | undefined
  readonly planEvents: PlanEvents | null | undefined
  readonly sessions: PlanSessions | null | undefined
  readonly activePlans: ActivePlans | null | undefined
  readonly externalTools: SurveyExternalTools | null | undefined
  readonly implementationStarts: ImplementationStarts | null | undefined
  readonly recovery: ActivePlanRecovering | null
  readonly stderr: Stderr | null | undefined
  readonly frontendRoot: string
  server: Server | null

  constructor({
    port, startPlan, implementPlan, implementProgress, implementHistory, pullRequestReviews,
    planEvents, sessions, activePlans, externalTools, implementationStarts, recovery = null, stderr,
    frontendRoot,
  }: ApiCollaborators) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.implementPlan = implementPlan
    this.implementProgress = implementProgress
    this.implementHistory = implementHistory
    this.pullRequestReviews = pullRequestReviews
    this.planEvents = planEvents
    this.sessions = sessions
    this.activePlans = activePlans
    this.externalTools = externalTools
    this.implementationStarts = implementationStarts
    this.recovery = recovery
    this.stderr = stderr
    this.frontendRoot = frontendRoot
    this.server = null
  }

  #route(): Express {
    const app = express()
    app.disable('x-powered-by')
    app.set('case sensitive routing', true)
    app.use(Route.collapseTrailingSlashes)
    FrontendPages.mountedOn(app, this.frontendRoot)
    app.post(
      StartPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      StartPlanRoute.handledBy(this.startPlan!, this.sessions!)
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
    app.post(
      ImplementPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ImplementPlanRoute.handledBy(
        this.implementPlan!, this.pullRequestReviews!,
        this.activePlans!, this.implementationStarts!, this.stderr!
      )
    )
    app.all(ImplementPlanRoute.PATH, ImplementPlanRoute.refuseOtherMethods)
    app.get(
      PlanEventsRoute.PATH,
      Browsers.turnAwayForeign,
      PlanEventsRoute.handledBy(this.sessions!, this.planEvents!)
    )
    app.all(PlanEventsRoute.PATH, PlanEventsRoute.refuseOtherMethods)
    app.get(
      ActivePlansRoute.PATH,
      Browsers.turnAwayForeign,
      ActivePlansRoute.handledBy(this.activePlans!, this.recovery)
    )
    app.all(ActivePlansRoute.PATH, ActivePlansRoute.refuseOtherMethods)
    app.get(
      ImplementProgressRoute.PATH,
      Browsers.turnAwayForeign,
      ImplementProgressRoute.handledBy(this.implementProgress!)
    )
    app.all(ImplementProgressRoute.PATH, ImplementProgressRoute.refuseOtherMethods)
    app.get(
      ImplementHistoryRoute.PATH,
      Browsers.turnAwayForeign,
      ImplementHistoryRoute.handledBy(this.implementHistory!)
    )
    app.all(ImplementHistoryRoute.PATH, ImplementHistoryRoute.refuseOtherMethods)
    app.get(
      ExternalToolsRoute.PATH,
      Browsers.turnAwayForeign,
      ExternalToolsRoute.handledBy(this.externalTools!)
    )
    app.all(ExternalToolsRoute.PATH, ExternalToolsRoute.refuseOtherMethods)
    app.use(Failures.nothingMatched)
    app.use(Failures.answer)

    return app
  }

  async start(): Promise<number> {
    if (this.server !== null) {
      throw new Error('start() was called on a server that is already listening')
    }
    const server = createServer(this.#route())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.requestedPort, LOOPBACK, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    this.server = server

    return (server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    if (this.server === null) return
    const server = this.server
    this.server = null
    await new Promise<unknown>((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
}
