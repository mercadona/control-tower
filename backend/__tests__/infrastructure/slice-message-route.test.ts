import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { SliceMessageRoute } from '../../src/infrastructure/slice-message-route.ts'
import type { SliceChangeAsked } from '../../src/infrastructure/slice-message-route.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

const AGENT = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const REPO = 'owner/name'
const TEXT = 'Please rename the export.'

type FixAsked = { agent: string, issue: number, repository: RepositoryName, changes: string }

class FixesSpy {
  readonly asked: FixAsked[] = []
  readonly failure: Error | null

  constructor(failure: Error | null = null) {
    this.failure = failure
  }

  get fixes(): SliceChangeAsked {
    return async (asked) => {
      this.asked.push(asked)
      if (this.failure !== null) throw this.failure
    }
  }
}

class RunningApi {
  static readonly #servers: Server[] = []

  static async listening(fixes: SliceChangeAsked): Promise<number> {
    const app = express()
    app.post(
      SliceMessageRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SliceMessageRoute.handledBy(fixes),
    )
    app.all(SliceMessageRoute.PATH, SliceMessageRoute.refuseOtherMethods)
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    RunningApi.#servers.push(server)

    return (server.address() as AddressInfo).port
  }

  static async stop(): Promise<void> {
    await Promise.all(
      RunningApi.#servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
  }
}

afterEach(async () => {
  await RunningApi.stop()
})

const post = (port: number, path: string, body: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
    body,
  })

describe('SliceMessageRoute', () => {
  it('a posted message reaches the recorded conversation of that issue', async () => {
    const spy = new FixesSpy()
    const port = await RunningApi.listening(spy.fixes)

    const response = await post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'delivered' })
    expect(spy.asked).toEqual([{ agent: AGENT, issue: 42, repository: new RepositoryName(REPO), changes: TEXT }])
  })

  it('an unknown field, an empty text and a malformed issue each refuse with their own code', async () => {
    const spy = new FixesSpy()
    const port = await RunningApi.listening(spy.fixes)

    const unknownField = await post(
      port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT, extra: 'x' })
    )
    const emptyText = await post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: '' }))
    const malformedIssue = await post(
      port, '/slices/abc/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT })
    )

    expect(await unknownField.json()).toMatchObject({ code: 'unknown-field' })
    expect(await emptyText.json()).toMatchObject({ code: 'slice-message-malformed-text' })
    expect(await malformedIssue.json()).toMatchObject({ code: 'slice-message-malformed-issue' })
    expect(spy.asked).toEqual([])
  })

  it('a conversation that is not the record of that issue refuses as not delivered', async () => {
    const detail = `conversation ${JSON.stringify(AGENT)} is not the record of #42`
    const spy = new FixesSpy(new PlanAgentNotResumed(detail))
    const port = await RunningApi.listening(spy.fixes)

    const response = await post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'slice-message-not-delivered', detail })
  })

  it('the other methods of the path answer with an allow header', async () => {
    const spy = new FixesSpy()
    const port = await RunningApi.listening(spy.fixes)

    const response = await fetch(`http://127.0.0.1:${port}/slices/42/message`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
