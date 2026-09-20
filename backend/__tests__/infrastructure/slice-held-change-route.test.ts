import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { SliceHeldChangeRoute } from '../../src/infrastructure/slice-message-route.ts'
import type { SliceChangeHeld } from '../../src/infrastructure/slice-message-route.ts'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

const AGENT = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const REPO = 'owner/name'
const TEXT = 'Please rename the export.'
const TICKET = '7c3d9e1f'

type HeldAsked = { agent: string, issue: number, repository: RepositoryName, changes: string }

class HoldSpy {
  readonly asked: HeldAsked[] = []
  readonly failure: Error | null

  constructor(failure: Error | null = null) {
    this.failure = failure
  }

  get hold(): SliceChangeHeld {
    return async (asked) => {
      this.asked.push(asked)
      if (this.failure !== null) throw this.failure

      return TICKET
    }
  }
}

class RunningApi {
  static readonly #servers: Server[] = []

  static async listening(hold: SliceChangeHeld): Promise<number> {
    const app = express()
    app.post(
      SliceHeldChangeRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      SliceHeldChangeRoute.handledBy(hold),
    )
    app.all(SliceHeldChangeRoute.PATH, SliceHeldChangeRoute.refuseOtherMethods)
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

  static post(port: number, path: string, body: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body,
    })
  }

  static body(repo: string = REPO, agent: string = AGENT, text: string = TEXT): string {
    return JSON.stringify({ repo, agent, text })
  }
}

afterEach(async () => {
  await RunningApi.stop()
})

describe('SliceHeldChangeRoute', () => {
  it('a_change_a_slice_cannot_take_yet_is_kept_and_answered_with_the_ticket_that_names_it', async () => {
    const spy = new HoldSpy()
    const port = await RunningApi.listening(spy.hold)

    const response = await RunningApi.post(port, '/slices/42/held-change', RunningApi.body())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'held', ticket: TICKET })
    expect(spy.asked).toEqual([
      { agent: AGENT, issue: 42, repository: new RepositoryName(REPO), changes: TEXT },
    ])
  })

  it('it_is_a_second_door_and_not_the_message_one_so_asking_to_hold_never_delivers', async () => {
    expect(SliceHeldChangeRoute.PATH).toBe('/slices/:issue/held-change')
    expect(SliceHeldChangeRoute.STATUS).toBe('held')
  })

  it('a_refusal_that_belongs_to_the_plan_is_collapsed_with_the_code_the_message_door_already_uses', async () => {
    const spy = new HoldSpy(new PlanAgentNotResumed('that conversation predates the journal'))
    const port = await RunningApi.listening(spy.hold)

    const response = await RunningApi.post(port, '/slices/42/held-change', RunningApi.body())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'slice-message-not-delivered' })
  })

  it('a_malformed_request_is_refused_by_the_very_parser_the_message_door_uses', async () => {
    const spy = new HoldSpy()
    const port = await RunningApi.listening(spy.hold)

    const badIssue = await RunningApi.post(port, '/slices/0/held-change', RunningApi.body())
    const badText = await RunningApi.post(port, '/slices/42/held-change', RunningApi.body(REPO, AGENT, ''))
    const unknown = await RunningApi.post(port, '/slices/42/held-change', JSON.stringify({
      repo: REPO, agent: AGENT, text: TEXT, when: 'later',
    }))

    expect(badIssue.status).toBe(400)
    expect(await badIssue.json()).toMatchObject({ code: 'slice-message-malformed-issue' })
    expect(await badText.json()).toMatchObject({ code: 'slice-message-malformed-text' })
    expect(await unknown.json()).toMatchObject({ code: 'unknown-field' })
    expect(spy.asked).toEqual([])
  })

  it('a_method_that_is_not_post_is_turned_away_naming_the_one_that_is', async () => {
    const spy = new HoldSpy()
    const port = await RunningApi.listening(spy.hold)

    const response = await fetch(`http://127.0.0.1:${port}/slices/42/held-change`, {
      method: 'GET',
      headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
