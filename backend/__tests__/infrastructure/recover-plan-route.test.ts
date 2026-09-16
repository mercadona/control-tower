import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { RecoverPlan, type RecoverPlanParams } from '../../src/application/actions/recover-plan.ts'
import { PlanAgents } from '../../src/domain/ports/plan-agents.ts'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { RecoverPlanRoute } from '../../src/infrastructure/recover-plan-route.ts'
import { Reservation, WorkInFlight } from '../../src/infrastructure/work-in-flight.ts'
import * as exceptions from '../../src/domain/exceptions.ts'

class RecoverPlanSpy extends RecoverPlan {
  readonly asked: RecoverPlanParams[] = []
  readonly failures: Error[]

  constructor(...failures: Error[]) {
    super({ agents: new PlanAgents() })
    this.failures = failures
  }

  override async execute(params: RecoverPlanParams): Promise<void> {
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

  static async start(action: RecoverPlan, projection: RecoveryProjectionSpy, inFlight = new WorkInFlight()): Promise<number> {
    const app = express()
    app.post(
      RecoverPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      RecoverPlanRoute.handledBy(action, projection, inFlight),
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

describe('RecoverPlanRoute', () => {
  const request = {
    repo: 'mercadona/control-tower-plugin', issue: 331, agent: '11111111-1111-4111-8111-111111111111',
  }

  it('recovery validates identity before action', async () => {
    const action = new RecoverPlanSpy()
    const projection = new RecoveryProjectionSpy()
    const port = await RunningApi.start(action, projection)

    const response = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'mercadona/control-tower-plugin', issue: 331, agent: 'not-a-conversation' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'recover-plan-invalid-request' }))
    expect(action.asked).toEqual([])
    expect(projection.calls).toBe(0)
  })

  it('recovery accepts the original identity and refreshes projection', async () => {
    const action = new RecoverPlanSpy()
    const projection = new RecoveryProjectionSpy()
    const port = await RunningApi.start(action, projection)
    const agent = '11111111-1111-4111-8111-111111111111'

    const response = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: 'mercadona/control-tower-plugin', issue: 331, agent }),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ agent })
    expect(action.asked[0]).toMatchObject({ agent, issue: 331 })
    expect(action.asked[0].repository.text).toBe('mercadona/control-tower-plugin')
    expect(projection.calls).toBe(1)
  })

  it('start recovery and cleanup share repository exclusion', async () => {
    const action = new RecoverPlanSpy()
    const projection = new RecoveryProjectionSpy()
    const inFlight = new WorkInFlight()
    expect(inFlight.reserve('mercadona/control-tower-plugin')).toBe(Reservation.RESERVED)
    const port = await RunningApi.start(action, projection, inFlight)

    const response = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo: 'mercadona/control-tower-plugin', issue: 331, agent: '11111111-1111-4111-8111-111111111111',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'recover-plan-in-progress' }))
    expect(action.asked).toEqual([])
  })

  it('foreign origins cannot recover', async () => {
    const action = new RecoverPlanSpy()
    const port = await RunningApi.start(action, new RecoveryProjectionSpy())

    const response = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://foreign.example' },
      body: '{}',
    })

    expect(response.status).toBe(403)
    expect(action.asked).toEqual([])
  })

  it('recovery family has exhaustive refusals', async () => {
    const reflected = Object.entries(exceptions).flatMap(([name, thrown]) => (
      name !== 'PlanRecoveryFailure'
      && (thrown as { prototype: object }).prototype instanceof exceptions.PlanRecoveryFailure ? [name] : []
    ))
    expect(RecoverPlanRoute.declaredFailures().sort()).toEqual(reflected.sort())

    const cases = [
      [new exceptions.PlanRecoveryNotFound('missing'), 'recover-plan-not-found'],
      [new exceptions.PlanRecoveryConflict('busy'), 'recover-plan-conflict'],
      [new exceptions.PlanRecoveryNotRead('tool failed'), 'recover-plan-failed'],
      [new exceptions.PlanRecoveryNotUnderstood('evidence changed'), 'recover-plan-unreadable'],
    ] as const
    for (const [failure, code] of cases) {
      const projection = new RecoveryProjectionSpy()
      const port = await RunningApi.start(new RecoverPlanSpy(failure), projection)
      const response = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code, detail: failure.message })
      expect(projection.calls).toBe(0)
    }
  })

  it('bare and unknown recovery failures are not defaulted and release the reservation', async () => {
    class UnknownRecovery extends exceptions.PlanRecoveryNotRead {}
    for (const failure of [
      new exceptions.PlanRecoveryFailure('bare recovery failure'),
      new UnknownRecovery('unknown recovery failure'),
    ]) {
      const projection = new RecoveryProjectionSpy()
      const port = await RunningApi.start(new RecoverPlanSpy(failure), projection)
      const first = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      const second = await fetch(`http://127.0.0.1:${port}${RecoverPlanRoute.PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      expect(first.status).toBe(500)
      expect(second.status).toBe(202)
      expect(projection.calls).toBe(1)
    }
  })
})
