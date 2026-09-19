import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Browsers } from '../../src/infrastructure/http.ts'
import { SliceEscalationRoute } from '../../src/infrastructure/slice-escalation-route.ts'
import {
  ReadSliceEscalationParams, ReadSliceEscalationResult,
} from '../../src/application/queries/read-slice-escalation.ts'
import { SliceEscalationNotRead, SliceEscalationNotUnderstood } from '../../src/domain/exceptions.ts'
import { SliceEscalation } from '../../src/domain/value-objects/slice-escalation.ts'

const ROOT = '/Users/someone/checkouts/control-tower'

class ReaderSpy {
  readonly asked: ReadSliceEscalationParams[] = []
  readonly answer: SliceEscalation
  readonly failure: Error | null

  constructor(answer: SliceEscalation = SliceEscalation.none(), failure: Error | null = null) {
    this.answer = answer
    this.failure = failure
  }

  async execute(params: ReadSliceEscalationParams): Promise<ReadSliceEscalationResult> {
    this.asked.push(params)
    if (this.failure !== null) throw this.failure
    return new ReadSliceEscalationResult({ escalation: this.answer })
  }
}

class RunningApi {
  static readonly #servers: Server[] = []

  static async listening(reader: ReaderSpy): Promise<number> {
    const app = express()
    app.get(SliceEscalationRoute.PATH, Browsers.turnAwayForeign, SliceEscalationRoute.handledBy(reader))
    app.all(SliceEscalationRoute.PATH, SliceEscalationRoute.refuseOtherMethods)
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

  static get(port: number, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    })
  }
}

afterEach(async () => {
  await RunningApi.stop()
})

describe('SliceEscalationRoute', () => {
  it('a slice that raised a question answers it with the reason and the unblock', async () => {
    const reader = new ReaderSpy(SliceEscalation.raised({
      reason: 'the spec does not say which repository the row lands in',
      unblock: 'a decision from the coordinating session',
      notes: [],
    }))
    const port = await RunningApi.listening(reader)

    const response = await RunningApi.get(port, `/slices/460/escalation?root=${encodeURIComponent(ROOT)}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      state: 'raised',
      reason: 'the spec does not say which repository the row lands in',
      unblock: 'a decision from the coordinating session',
      notes: [],
      detail: '',
    })
    expect(reader.asked).toHaveLength(1)
    expect(reader.asked[0].issue).toBe(460)
    expect(reader.asked[0].root.text).toBe(ROOT)
  })

  it('a slice with nothing raised answers that there is none', async () => {
    const reader = new ReaderSpy()
    const port = await RunningApi.listening(reader)

    const response = await RunningApi.get(port, `/slices/460/escalation?root=${encodeURIComponent(ROOT)}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ state: 'none', reason: '', unblock: '' })
  })

  it('a malformed root and a malformed issue each refuse with their own code', async () => {
    const reader = new ReaderSpy()
    const port = await RunningApi.listening(reader)

    const malformedRoot = await RunningApi.get(port, '/slices/460/escalation?root=relative/path')
    const malformedIssue = await RunningApi.get(port, `/slices/abc/escalation?root=${encodeURIComponent(ROOT)}`)

    expect(await malformedRoot.json()).toMatchObject({ code: 'malformed-escalation-root' })
    expect(await malformedIssue.json()).toMatchObject({ code: 'malformed-escalation-issue' })
    expect(reader.asked).toEqual([])
  })

  it('a state file that cannot be read or cannot be interpreted refuses with its own declared code', async () => {
    const unreadable = new ReaderSpy(SliceEscalation.none(), new SliceEscalationNotRead('EACCES: permission denied'))
    const unreadablePort = await RunningApi.listening(unreadable)
    const misread = new ReaderSpy(
      SliceEscalation.none(), new SliceEscalationNotUnderstood('the frontmatter of .agent/SLICE.md is not valid YAML'),
    )
    const misreadPort = await RunningApi.listening(misread)

    const first = await RunningApi.get(unreadablePort, `/slices/460/escalation?root=${encodeURIComponent(ROOT)}`)
    const second = await RunningApi.get(misreadPort, `/slices/460/escalation?root=${encodeURIComponent(ROOT)}`)

    expect(first.status).toBe(400)
    expect(await first.json()).toMatchObject({ code: 'slice-escalation-not-read' })
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({ code: 'slice-escalation-not-understood' })
  })

  it('the other methods of the path answer with an allow header', async () => {
    const reader = new ReaderSpy()
    const port = await RunningApi.listening(reader)

    const response = await fetch(`http://127.0.0.1:${port}/slices/460/escalation`, {
      method: 'POST', headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })
})
