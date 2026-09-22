import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { RunningServers } from '../servers.ts'
import { Browsers, JsonBody } from '../../src/infrastructure/http.ts'
import { AnotherRoundRoute } from '../../src/infrastructure/another-round-route.ts'
import type { AnotherRoundAsked } from '../../src/infrastructure/another-round-route.ts'
import { AnotherRoundNotGranted, PlanAgentNotResumed } from '../../src/domain/exceptions.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

const AGENT = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const REPO = 'owner/name'
const INSTRUCTION = 'Please try the async fix again, this time awaiting the flush.'

type RoundAsked = { agent: string, issue: number, repository: RepositoryName, instruction: string }

class GrantSpy {
  readonly asked: RoundAsked[] = []
  readonly failure: Error | null

  constructor(failure: Error | null = null) {
    this.failure = failure
  }

  get grant(): AnotherRoundAsked {
    return async (asked) => {
      if (this.failure !== null) throw this.failure
      this.asked.push(asked)
    }
  }
}

class RunningApi {
  static async listening(grant: AnotherRoundAsked): Promise<number> {
    const app = express()
    app.post(
      AnotherRoundRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      AnotherRoundRoute.handledBy(grant),
    )
    app.all(AnotherRoundRoute.PATH, AnotherRoundRoute.refuseOtherMethods)
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

describe('AnotherRoundRoute', () => {
  it('a granted round answers with the granted status and hands the words to the action', async () => {
    const spy = new GrantSpy()
    const port = await RunningApi.listening(spy.grant)

    const response = await RunningApi.post(
      port, '/slices/42/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: INSTRUCTION }),
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'granted' })
    expect(spy.asked).toEqual([{ agent: AGENT, issue: 42, repository: new RepositoryName(REPO), instruction: INSTRUCTION }])
  })

  it('an unknown field, an empty instruction and a malformed issue each refuse with their own code', async () => {
    const spy = new GrantSpy()
    const port = await RunningApi.listening(spy.grant)

    const unknownField = await RunningApi.post(
      port, '/slices/42/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: INSTRUCTION, extra: 'x' }),
    )
    const emptyInstruction = await RunningApi.post(
      port, '/slices/42/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: '' }),
    )
    const malformedIssue = await RunningApi.post(
      port, '/slices/abc/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: INSTRUCTION }),
    )

    expect(await unknownField.json()).toMatchObject({ code: 'unknown-field' })
    expect(await emptyInstruction.json()).toMatchObject({ code: 'another-round-malformed-instruction' })
    expect(await malformedIssue.json()).toMatchObject({ code: 'another-round-malformed-issue' })
    expect(spy.asked).toEqual([])
  })

  it('a run the judge did not close refuses with conflict and its own code', async () => {
    const detail = 'the last verdict on #42 is not a veto, so there is no round to grant'
    const spy = new GrantSpy(new AnotherRoundNotGranted(detail))
    const port = await RunningApi.listening(spy.grant)

    const response = await RunningApi.post(
      port, '/slices/42/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: INSTRUCTION }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'another-round-not-granted', detail })
    expect(spy.asked).toEqual([])
  })

  it('a conversation that is not the record of that issue refuses as not delivered', async () => {
    const detail = `conversation ${JSON.stringify(AGENT)} is not the record of #42`
    const spy = new GrantSpy(new PlanAgentNotResumed(detail))
    const port = await RunningApi.listening(spy.grant)

    const response = await RunningApi.post(
      port, '/slices/42/another-round', JSON.stringify({ repo: REPO, agent: AGENT, instruction: INSTRUCTION }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'another-round-not-delivered', detail })
    expect(spy.asked).toEqual([])
  })

  it('the other methods of the path answer with an allow header', async () => {
    const spy = new GrantSpy()
    const port = await RunningApi.listening(spy.grant)

    const response = await fetch(`http://127.0.0.1:${port}/slices/42/another-round`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
