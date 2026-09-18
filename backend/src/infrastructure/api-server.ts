import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Answer, Route, Browsers, JsonBody } from './http.ts'
import { StartPlanRoute } from './start-plan-route.ts'
import { PlanEventsRoute } from './plan-events-route.ts'
import { ActivePlanPhase, ActivePlansRoute } from './active-plans-route.ts'
import { ImplementProgressRoute } from './implement-progress-route.ts'
import { ImplementHistoryRoute } from './implement-history-route.ts'
import { ExternalToolsRoute } from './external-tools-route.ts'
import { SessionsRoute } from './sessions-route.ts'
import { SessionStreamRoute } from './session-stream-route.ts'
import { SessionInputRoute } from './session-input-route.ts'
import { SessionResizeRoute } from './session-resize-route.ts'
import { CoordinatingSessionRoute } from './coordinating-session-route.ts'
import { CoordinatingSessionCloseRoute } from './coordinating-session-close-route.ts'
import { GroomSessionRoute } from './groom-session-route.ts'
import { SessionHooksRoute } from './session-hooks-route.ts'
import { SpecFreezeRoute } from './spec-freeze-route.ts'
import { SpecReslicingRoute } from './spec-reslicing-route.ts'
import { EpicGroomRoute } from './epic-groom-route.ts'
import { EpicPromotionRoute } from './epic-promotion-route.ts'
import { RecoverPlanRoute } from './recover-plan-route.ts'
import { CleanupPlanRoute } from './cleanup-plan-route.ts'
import { SliceMessageRoute } from './slice-message-route.ts'
import type { SliceChangeAsked } from './slice-message-route.ts'
import type { StartPlan } from '../application/actions/start-plan.ts'
import type { StartMilestonePlan } from '../application/actions/start-milestone-plan.ts'
import type { RecoverPlan } from '../application/actions/recover-plan.ts'
import type { CleanupPlan } from '../application/actions/cleanup-plan.ts'
import type { OpenCoordinatingSession } from '../application/actions/open-coordinating-session.ts'
import type { OpenGroomSession } from '../application/actions/open-groom-session.ts'
import type { CloseCoordinatingSession } from '../application/actions/close-coordinating-session.ts'
import type { CoordinatingSessions } from './coordinating-sessions.ts'
import type { GateKey } from './gate-key.ts'
import { WorkInFlight } from './work-in-flight.ts'
import type { ReadSpecFreeze } from '../application/queries/read-spec-freeze.ts'
import type { FreezeSpec } from '../application/actions/freeze-spec.ts'
import type { PublishReslicing } from '../application/actions/publish-reslicing.ts'
import type { ReadEpicGroom } from '../application/queries/read-epic-groom.ts'
import type { GroomEpic } from '../application/actions/groom-epic.ts'
import type { PromoteEpic } from '../application/actions/promote-epic.ts'
import type { ReadImplementationProgressParams } from '../application/queries/read-implementation-progress.ts'
import type { ReadImplementationHistoryParams } from '../application/queries/read-implementation-history.ts'
import type { SurveyExternalTools } from '../application/queries/survey-external-tools.ts'
import type { ListLiveSessions } from '../application/queries/list-live-sessions.ts'
import type { WatchLiveSession } from '../application/queries/watch-live-session.ts'
import type { TypeIntoSession } from '../application/actions/type-into-session.ts'
import type { ResizeSession } from '../application/actions/resize-session.ts'
import type { PlanEvents, PlanSessions } from './plan-events-route.ts'
import type { ActivePlans, ActivePlanRecovering } from './active-plans-route.ts'
import type { ImplementationState } from '../domain/value-objects/implementation-state.ts'
import type { ImplementationHistoryEntry } from '../domain/value-objects/implementation-history-entry.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { LiveSessions } from '../domain/ports/live-sessions.ts'

export const LOOPBACK = '127.0.0.1'

type ImplementationProgressReader = {
  execute(params: ReadImplementationProgressParams): Promise<{ readonly state: ImplementationState }>,
}

type ImplementationHistoryReader = {
  execute(params: ReadImplementationHistoryParams): Promise<{ readonly entries: ImplementationHistoryEntry[] }>,
}

type Stderr = (line: string) => void

class EntrypointPlanSessionRegistry {
  readonly sessions: PlanSessions
  readonly activePlans: ActivePlans

  constructor({ sessions, activePlans }: { sessions: PlanSessions, activePlans: ActivePlans }) {
    this.sessions = sessions
    this.activePlans = activePlans
    Object.freeze(this)
  }

  remember(watch: PlanWatch): void {
    const found = this.activePlans.find({ issue: watch.issue.number, repository: watch.repository })
    if (found === null) {
      this.sessions.remember(watch)
      return
    }
    switch (found.phase) {
      case ActivePlanPhase.PLANNING:
        this.sessions.remember(watch)
        return
      case ActivePlanPhase.IMPLEMENTING:
      case ActivePlanPhase.UNCERTAIN:
        return
    }
  }
}

type RequestFailure = {
  readonly type?: unknown,
  readonly status?: unknown,
  readonly stack?: unknown,
  readonly message?: unknown,
}

export type ApiCollaborators = {
  port: number,
  startPlan?: StartPlan | null,
  startMilestonePlan?: StartMilestonePlan | null,
  startsInFlight?: WorkInFlight | null,
  recoverPlan?: RecoverPlan | null,
  cleanupPlan?: CleanupPlan | null,
  implementProgress?: ImplementationProgressReader | null,
  implementHistory?: ImplementationHistoryReader | null,
  planEvents?: PlanEvents | null,
  sessions?: PlanSessions | null,
  activePlans?: ActivePlans | null,
  externalTools?: SurveyExternalTools | null,
  listLiveSessions?: ListLiveSessions | null,
  liveSessions?: LiveSessions | null,
  watchLiveSession?: WatchLiveSession | null,
  typeIntoSession?: TypeIntoSession | null,
  resizeSession?: ResizeSession | null,
  recovery?: ActivePlanRecovering | null,
  openCoordinatingSession?: OpenCoordinatingSession | null,
  openGroomSession?: OpenGroomSession | null,
  closeCoordinatingSession?: CloseCoordinatingSession | null,
  coordinatingSessions?: CoordinatingSessions | null,
  readSpecFreeze?: ReadSpecFreeze | null,
  freezeSpec?: FreezeSpec | null,
  gateKey?: GateKey | null,
  freezesInFlight?: WorkInFlight | null,
  publishReslicing?: PublishReslicing | null,
  reslicingsInFlight?: WorkInFlight | null,
  readEpicGroom?: ReadEpicGroom | null,
  groomEpic?: GroomEpic | null,
  epicGroomInFlight?: WorkInFlight | null,
  promoteEpic?: PromoteEpic | null,
  sliceMessage?: SliceChangeAsked | null,
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
  readonly startMilestonePlan: StartMilestonePlan | null | undefined
  readonly startsInFlight: WorkInFlight
  readonly recoverPlan: RecoverPlan | null | undefined
  readonly cleanupPlan: CleanupPlan | null | undefined
  readonly implementProgress: ImplementationProgressReader | null | undefined
  readonly implementHistory: ImplementationHistoryReader | null | undefined
  readonly planEvents: PlanEvents | null | undefined
  readonly sessions: PlanSessions | null | undefined
  readonly activePlans: ActivePlans | null | undefined
  readonly externalTools: SurveyExternalTools | null | undefined
  readonly listLiveSessions: ListLiveSessions | null | undefined
  readonly liveSessions: LiveSessions | null | undefined
  readonly watchLiveSession: WatchLiveSession | null | undefined
  readonly typeIntoSession: TypeIntoSession | null | undefined
  readonly resizeSession: ResizeSession | null | undefined
  readonly recovery: ActivePlanRecovering | null
  readonly openCoordinatingSession: OpenCoordinatingSession | null | undefined
  readonly openGroomSession: OpenGroomSession | null | undefined
  readonly closeCoordinatingSession: CloseCoordinatingSession | null | undefined
  readonly coordinatingSessions: CoordinatingSessions | null | undefined
  readonly readSpecFreeze: ReadSpecFreeze | null | undefined
  readonly freezeSpec: FreezeSpec | null | undefined
  readonly gateKey: GateKey | null | undefined
  readonly freezesInFlight: WorkInFlight | null | undefined
  readonly publishReslicing: PublishReslicing | null | undefined
  readonly reslicingsInFlight: WorkInFlight | null | undefined
  readonly readEpicGroom: ReadEpicGroom | null | undefined
  readonly groomEpic: GroomEpic | null | undefined
  readonly epicGroomInFlight: WorkInFlight | null | undefined
  readonly promoteEpic: PromoteEpic | null | undefined
  readonly sliceMessage: SliceChangeAsked | null | undefined
  readonly stderr: Stderr | null | undefined
  readonly frontendRoot: string
  server: Server | null

  constructor({
    port, startPlan, startMilestonePlan, startsInFlight, recoverPlan, cleanupPlan, implementProgress, implementHistory,
    planEvents, sessions, activePlans, externalTools, listLiveSessions, liveSessions,
    watchLiveSession, typeIntoSession, resizeSession, recovery = null,
    openCoordinatingSession, openGroomSession, closeCoordinatingSession, coordinatingSessions,
    readSpecFreeze, freezeSpec, gateKey, freezesInFlight,
    publishReslicing, reslicingsInFlight, readEpicGroom, groomEpic, epicGroomInFlight, promoteEpic,
    sliceMessage, stderr, frontendRoot,
  }: ApiCollaborators) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.startMilestonePlan = startMilestonePlan
    this.startsInFlight = startsInFlight ?? new WorkInFlight()
    this.recoverPlan = recoverPlan
    this.cleanupPlan = cleanupPlan
    this.implementProgress = implementProgress
    this.implementHistory = implementHistory
    this.planEvents = planEvents
    this.sessions = sessions
    this.activePlans = activePlans
    this.externalTools = externalTools
    this.listLiveSessions = listLiveSessions
    this.liveSessions = liveSessions
    this.watchLiveSession = watchLiveSession
    this.typeIntoSession = typeIntoSession
    this.resizeSession = resizeSession
    this.recovery = recovery
    this.openCoordinatingSession = openCoordinatingSession
    this.openGroomSession = openGroomSession
    this.closeCoordinatingSession = closeCoordinatingSession
    this.coordinatingSessions = coordinatingSessions
    this.readSpecFreeze = readSpecFreeze
    this.freezeSpec = freezeSpec
    this.gateKey = gateKey
    this.freezesInFlight = freezesInFlight
    this.publishReslicing = publishReslicing
    this.reslicingsInFlight = reslicingsInFlight
    this.readEpicGroom = readEpicGroom
    this.groomEpic = groomEpic
    this.epicGroomInFlight = epicGroomInFlight
    this.promoteEpic = promoteEpic
    this.sliceMessage = sliceMessage
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
      StartPlanRoute.handledBy(
        this.startPlan!,
        new EntrypointPlanSessionRegistry({ sessions: this.sessions!, activePlans: this.activePlans! }),
        {
          milestone: this.startMilestonePlan ?? null,
          coordinating: this.coordinatingSessions ?? null,
          groom: this.readEpicGroom ?? null,
          inFlight: this.startsInFlight,
        },
      )
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
    app.post(
      RecoverPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      RecoverPlanRoute.handledBy(this.recoverPlan!, this.recovery!, this.startsInFlight),
    )
    app.all(RecoverPlanRoute.PATH, RecoverPlanRoute.refuseOtherMethods)
    app.post(
      CleanupPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      CleanupPlanRoute.handledBy(this.cleanupPlan!, this.recovery!, this.startsInFlight),
    )
    app.all(CleanupPlanRoute.PATH, CleanupPlanRoute.refuseOtherMethods)
    app.post(
      SliceMessageRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SliceMessageRoute.handledBy(this.sliceMessage!)
    )
    app.all(SliceMessageRoute.PATH, SliceMessageRoute.refuseOtherMethods)
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
    app.get(
      SessionsRoute.PATH,
      Browsers.turnAwayForeign,
      SessionsRoute.handledBy(this.listLiveSessions!)
    )
    app.all(SessionsRoute.PATH, SessionsRoute.refuseOtherMethods)
    app.get(
      SessionStreamRoute.PATH,
      Browsers.turnAwayForeign,
      SessionStreamRoute.handledBy(this.liveSessions!, this.watchLiveSession!)
    )
    app.all(SessionStreamRoute.PATH, SessionStreamRoute.refuseOtherMethods)
    app.post(
      SessionInputRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SessionInputRoute.handledBy(this.liveSessions!, this.typeIntoSession!)
    )
    app.all(SessionInputRoute.PATH, SessionInputRoute.refuseOtherMethods)
    app.post(
      SessionResizeRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SessionResizeRoute.handledBy(this.liveSessions!, this.resizeSession!)
    )
    app.all(SessionResizeRoute.PATH, SessionResizeRoute.refuseOtherMethods)
    app.post(
      CoordinatingSessionCloseRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      CoordinatingSessionCloseRoute.closing(this.closeCoordinatingSession!, this.coordinatingSessions!)
    )
    app.all(CoordinatingSessionCloseRoute.PATH, CoordinatingSessionCloseRoute.refuseOtherMethods)
    app.post(
      CoordinatingSessionRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      CoordinatingSessionRoute.opening(this.openCoordinatingSession!, this.coordinatingSessions!)
    )
    app.get(
      CoordinatingSessionRoute.PATH,
      Browsers.turnAwayForeign,
      CoordinatingSessionRoute.reading(this.coordinatingSessions!)
    )
    app.all(CoordinatingSessionRoute.PATH, CoordinatingSessionRoute.refuseOtherMethods)
    app.post(
      GroomSessionRoute.PATH,
      Browsers.turnAwayForeign,
      GroomSessionRoute.opening(this.coordinatingSessions!, this.openGroomSession!, this.gateKey!)
    )
    app.all(GroomSessionRoute.PATH, GroomSessionRoute.refuseOtherMethods)
    app.post(
      SessionHooksRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SessionHooksRoute.handledBy(this.coordinatingSessions!)
    )
    app.all(SessionHooksRoute.PATH, SessionHooksRoute.refuseOtherMethods)
    app.get(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.reading(this.coordinatingSessions!, this.readSpecFreeze!, this.gateKey!))
    app.post(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.freezing(this.coordinatingSessions!, this.freezeSpec!, this.gateKey!, this.freezesInFlight!))
    app.all(SpecFreezeRoute.PATH, SpecFreezeRoute.refuseOtherMethods)
    app.post(SpecReslicingRoute.PATH, Browsers.turnAwayForeign,
      SpecReslicingRoute.publishing(
        this.coordinatingSessions!, this.publishReslicing!, this.gateKey!, this.reslicingsInFlight!
      ))
    app.all(SpecReslicingRoute.PATH, SpecReslicingRoute.refuseOtherMethods)
    app.get(EpicGroomRoute.PATH, Browsers.turnAwayForeign,
      EpicGroomRoute.reading(this.coordinatingSessions!, this.readEpicGroom!, this.gateKey!))
    app.post(EpicGroomRoute.PATH, Browsers.turnAwayForeign,
      EpicGroomRoute.grooming(this.coordinatingSessions!, this.groomEpic!, this.gateKey!, this.epicGroomInFlight!, this.stderr!))
    app.all(EpicGroomRoute.PATH, EpicGroomRoute.refuseOtherMethods)
    app.post(EpicPromotionRoute.PATH, Browsers.turnAwayForeign,
      EpicPromotionRoute.promoting(this.coordinatingSessions!, this.promoteEpic!, this.gateKey!, this.stderr!))
    app.all(EpicPromotionRoute.PATH, EpicPromotionRoute.refuseOtherMethods)
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
