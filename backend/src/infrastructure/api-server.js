import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { Answer, Route, Browsers, JsonBody } from './http.ts'
import { StartPlanRoute } from './start-plan-route.ts'
import { ImplementPlanRoute } from './implement-plan-route.ts'
import { ReviewPlanRoute } from './review-plan-route.ts'
import { PlanEventsRoute } from './plan-events-route.ts'
import { ActivePlansRoute } from './active-plans-route.ts'
import { ImplementProgressRoute } from './implement-progress-route.ts'
import { ExternalToolsRoute } from './external-tools-route.ts'

export const LOOPBACK = '127.0.0.1'
class FrontendPages {
  static mountedOn(app, root) {
    if (!existsSync(root)) return
    app.use(express.static(root, { index: 'index.html', redirect: false, fallthrough: true }))
  }
}
class Failures {
  static nothingMatched(request, response) {
    Answer.refuse(response, 404, 'not-found', 'not found')
  }

  static answer(cause, request, response, next) {
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
  constructor({
    port, startPlan, implementPlan, askPlanChanges, implementProgress, reviews, pullRequestReviews, planEvents,
    readPlanProgress, sessions, activePlans, externalTools, implementationStarts, recovery = null, stderr,
    frontendRoot,
  }) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.implementPlan = implementPlan
    this.askPlanChanges = askPlanChanges
    this.implementProgress = implementProgress
    this.reviews = reviews
    this.pullRequestReviews = pullRequestReviews
    this.planEvents = planEvents
    this.readPlanProgress = readPlanProgress
    this.sessions = sessions
    this.activePlans = activePlans
    this.externalTools = externalTools
    this.implementationStarts = implementationStarts
    this.recovery = recovery
    this.stderr = stderr
    this.frontendRoot = frontendRoot
    this.server = null
  }

  #route() {
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
      StartPlanRoute.handledBy(this.startPlan, this.sessions, this.reviews)
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
    app.post(
      ImplementPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ImplementPlanRoute.handledBy(
        this.implementPlan, this.reviews, this.pullRequestReviews,
        this.activePlans, this.implementationStarts, this.readPlanProgress, this.stderr
      )
    )
    app.all(ImplementPlanRoute.PATH, ImplementPlanRoute.refuseOtherMethods)
    app.post(
      ReviewPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ReviewPlanRoute.handledBy(this.askPlanChanges, this.activePlans)
    )
    app.all(ReviewPlanRoute.PATH, ReviewPlanRoute.refuseOtherMethods)
    app.get(
      PlanEventsRoute.PATH,
      Browsers.turnAwayForeign,
      PlanEventsRoute.handledBy(this.sessions, this.planEvents)
    )
    app.all(PlanEventsRoute.PATH, PlanEventsRoute.refuseOtherMethods)
    app.get(
      ActivePlansRoute.PATH,
      Browsers.turnAwayForeign,
      ActivePlansRoute.handledBy(this.activePlans, this.recovery)
    )
    app.all(ActivePlansRoute.PATH, ActivePlansRoute.refuseOtherMethods)
    app.get(
      ImplementProgressRoute.PATH,
      Browsers.turnAwayForeign,
      ImplementProgressRoute.handledBy(this.implementProgress)
    )
    app.all(ImplementProgressRoute.PATH, ImplementProgressRoute.refuseOtherMethods)
    app.get(
      ExternalToolsRoute.PATH,
      Browsers.turnAwayForeign,
      ExternalToolsRoute.handledBy(this.externalTools)
    )
    app.all(ExternalToolsRoute.PATH, ExternalToolsRoute.refuseOtherMethods)
    app.use(Failures.nothingMatched)
    app.use(Failures.answer)

    return app
  }

  async start() {
    if (this.server !== null) {
      throw new Error('start() was called on a server that is already listening')
    }
    const server = createServer(this.#route())
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.requestedPort, LOOPBACK, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    this.server = server

    return server.address().port
  }

  async stop() {
    if (this.server === null) return
    const server = this.server
    this.server = null
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
}
