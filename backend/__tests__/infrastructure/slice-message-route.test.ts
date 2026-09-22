import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RunningServers } from '../servers.ts'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { SliceMessageRoute } from '../../src/infrastructure/slice-message-route.ts'
import type { SliceChangeAsked } from '../../src/infrastructure/slice-message-route.ts'
import {
  PlanAgentNotResumed, PlanStatusNotRead, PlanStatusNotUnderstood,
} from '../../src/domain/exceptions.ts'
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
    return RunningServers.listening(app)
  }

  static async stop(): Promise<void> {
    await RunningServers.stopAll()
  }

  static post(port: number, path: string, body: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body,
    })
  }
}

afterEach(async () => {
  await RunningApi.stop()
})

describe('SliceMessageRoute', () => {
  it('a posted message reaches the recorded conversation of that issue', async () => {
    const spy = new FixesSpy()
    const port = await RunningApi.listening(spy.fixes)

    const response = await RunningApi.post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'delivered' })
    expect(spy.asked).toEqual([{ agent: AGENT, issue: 42, repository: new RepositoryName(REPO), changes: TEXT }])
  })

  it('an unknown field, an empty text and a malformed issue each refuse with their own code', async () => {
    const spy = new FixesSpy()
    const port = await RunningApi.listening(spy.fixes)

    const unknownField = await RunningApi.post(
      port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT, extra: 'x' })
    )
    const emptyText = await RunningApi.post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: '' }))
    const malformedIssue = await RunningApi.post(
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

    const response = await RunningApi.post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'slice-message-not-delivered', detail })
  })

  it('a status the route had to read and could not refuses with its own declared code', async () => {
    const detail = 'gh issue view --json labels failed: HTTP 502'
    const spy = new FixesSpy(new PlanStatusNotRead(detail))
    const port = await RunningApi.listening(spy.fixes)

    const response = await RunningApi.post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'slice-message-status-not-read', detail })
  })

  it('a status that reads as two labels at once refuses with its own declared code', async () => {
    const detail = '42 wears more than one status label (status:in-review, status:in-progress)'
    const spy = new FixesSpy(new PlanStatusNotUnderstood(detail))
    const port = await RunningApi.listening(spy.fixes)

    const response = await RunningApi.post(port, '/slices/42/message', JSON.stringify({ repo: REPO, agent: AGENT, text: TEXT }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'slice-message-status-not-understood', detail })
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
