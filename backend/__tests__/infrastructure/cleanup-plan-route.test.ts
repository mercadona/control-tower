import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { CleanupPlan, type CleanupPlanParams } from '../../src/application/actions/cleanup-plan.ts'
import { DispatchClaims } from '../../src/domain/ports/dispatch-claims.ts'
import { PlanIssues } from '../../src/domain/ports/plan-issues.ts'
import { PlanRecords } from '../../src/domain/ports/plan-records.ts'
import { Workspace } from '../../src/domain/ports/workspace.ts'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { CleanupPlanRoute } from '../../src/infrastructure/cleanup-plan-route.ts'
import { WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import * as exceptions from '../../src/domain/exceptions.ts'

class CleanupPlanSpy extends CleanupPlan {
  readonly asked: CleanupPlanParams[] = []
  readonly failures: Error[]

  constructor(...failures: Error[]) {
    super({ records: new PlanRecords(), workspace: new Workspace(), claims: new DispatchClaims(), planIssues: new PlanIssues() })
    this.failures = failures
  }

  override async execute(params: CleanupPlanParams): Promise<void> {
    this.asked.push(params)
    const failure = this.failures.shift()
    if (failure !== undefined) throw failure
  }
}

class RecoveryProjectionSpy {
  calls = 0

  async recover(): Promise<string | null> {
    this.calls += 1
    return null
  }
}

class RunningApi {
  static readonly #servers: Server[] = []

  static async start(action: CleanupPlan, projection: RecoveryProjectionSpy): Promise<number> {
    const app = express()
    app.post(
      CleanupPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      CleanupPlanRoute.handledBy(action, projection, new WorkInFlight()),
    )
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    RunningApi.#servers.push(server)
    return (server.address() as AddressInfo).port
  }

  static async stop(): Promise<void> {
    await Promise.all(RunningApi.#servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  }
}

afterEach(async () => RunningApi.stop())

describe('CleanupPlanRoute', () => {
  const request = {
    repo: 'mercadona/control-tower-plugin', issue: 331, agent: '11111111-1111-4111-8111-111111111111',
  }

  it('cleanup validates identity before action', async () => {
    const action = new CleanupPlanSpy()
    const projection = new RecoveryProjectionSpy()
    const port = await RunningApi.start(action, projection)

    const response = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'mercadona/control-tower-plugin', issue: 0, agent: '11111111-1111-4111-8111-111111111111' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'cleanup-plan-invalid-request' }))
    expect(action.asked).toEqual([])
  })

  it('cleanup answers only after retirement and projection refresh', async () => {
    let retire: () => void = () => {}
    let enter: () => void = () => {}
    const retirement = new Promise<void>((resolve) => { retire = resolve })
    const entered = new Promise<void>((resolve) => { enter = resolve })
    class DeferredCleanup extends CleanupPlanSpy {
      override async execute(params: CleanupPlanParams): Promise<void> {
        this.asked.push(params)
        enter()
        await retirement
      }
    }
    const action = new DeferredCleanup()
    const projection = new RecoveryProjectionSpy()
    const port = await RunningApi.start(action, projection)
    const agent = '11111111-1111-4111-8111-111111111111'
    let answered = false

    const response = fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'mercadona/control-tower-plugin', issue: 331, agent }),
    }).then((value) => { answered = true; return value })
    await entered
    expect(answered).toBe(false)
    retire()

    const completed = await response
    expect(completed.status).toBe(200)
    expect(await completed.json()).toEqual({ agent })
    expect(projection.calls).toBe(1)
  })

  it('foreign origins cannot clean', async () => {
    const action = new CleanupPlanSpy()
    const port = await RunningApi.start(action, new RecoveryProjectionSpy())

    const response = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://foreign.example' },
      body: '{}',
    })

    expect(response.status).toBe(403)
    expect(action.asked).toEqual([])
  })

  it('cleanup family has exhaustive refusals', async () => {
    const reflected = Object.entries(exceptions).flatMap(([name, thrown]) => (
      name !== 'PlanCleanupFailure'
      && (thrown as { prototype: object }).prototype instanceof exceptions.PlanCleanupFailure ? [name] : []
    ))
    const dedicated = CleanupPlanRoute.declaredFailures().filter((name) => name.startsWith('PlanCleanup'))
    expect(dedicated.sort()).toEqual(reflected.sort())

    const cases = [
      [new exceptions.PlanCleanupNotFound('missing'), 'cleanup-plan-not-found'],
      [new exceptions.PlanCleanupConflict('changed'), 'cleanup-plan-conflict'],
      [new exceptions.PlanCleanupNotRead('tool failed'), 'cleanup-plan-failed'],
      [new exceptions.PlanCleanupNotUnderstood('evidence changed'), 'cleanup-plan-unreadable'],
    ] as const
    for (const [failure, code] of cases) {
      const projection = new RecoveryProjectionSpy()
      const port = await RunningApi.start(new CleanupPlanSpy(failure), projection)
      const response = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code, detail: failure.message })
      expect(projection.calls).toBe(0)
    }
  })

  it('cleanup collaborator causes retain their refusal kind', async () => {
    const cases = [
      [new exceptions.PlanAgentNotLaunched('record read failed'), 'cleanup-plan-failed'],
      [new exceptions.PlanStatusNotRead('status read failed'), 'cleanup-plan-failed'],
      [new exceptions.PlanAgentNotNamed('record malformed'), 'cleanup-plan-unreadable'],
      [new exceptions.PlanStatusNotUnderstood('status malformed'), 'cleanup-plan-unreadable'],
    ] as const
    for (const [failure, code] of cases) {
      const port = await RunningApi.start(new CleanupPlanSpy(failure), new RecoveryProjectionSpy())
      const response = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code, detail: failure.message })
    }
  })

  it('bare and unknown cleanup failures are not defaulted and release the reservation', async () => {
    class UnknownCleanup extends exceptions.PlanCleanupNotRead {}
    for (const failure of [
      new exceptions.PlanCleanupFailure('bare cleanup failure'),
      new UnknownCleanup('unknown cleanup failure'),
    ]) {
      const projection = new RecoveryProjectionSpy()
      const port = await RunningApi.start(new CleanupPlanSpy(failure), projection)
      const first = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      const second = await fetch(`http://127.0.0.1:${port}${CleanupPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(first.status).toBe(500)
      expect(second.status).toBe(200)
      expect(projection.calls).toBe(1)
    }
  })
})
