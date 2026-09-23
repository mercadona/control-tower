import { afterEach, describe, expect, it } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.ts'
import { ReadWorkProgressResult, type ReadWorkProgressParams } from '../../src/application/queries/read-work-progress.ts'
import { WorkProgress } from '../../src/domain/value-objects/work-progress.ts'
import { WorkProgressMother } from '../work-progress-mother.ts'
import { WorkNotFound, WorkNotRead, WorkNotUnderstood } from '../../src/domain/exceptions.ts'

class RunningWorkApi {
  static readonly live: ApiServer[] = []
  readonly requests: ReadWorkProgressParams[] = []
  failure: Error | null = null
  readonly server = new ApiServer({
    port: 0, frontendRoot: '/no-frontend',
    workProgress: { execute: async (params) => {
      this.requests.push(params)
      if (this.failure !== null) throw this.failure
      return new ReadWorkProgressResult(new WorkProgress(WorkProgressMother.watch(), {
        phase: 'planning', plan: { kind: 'available', value: 'ready' },
        activity: { kind: 'unavailable', detail: 'stream unreadable' },
      }))
    } },
  })

  async start(): Promise<string> {
    RunningWorkApi.live.push(this.server)
    return `http://127.0.0.1:${await this.server.start()}`
  }

  static async stop(): Promise<void> {
    await Promise.all(RunningWorkApi.live.splice(0).map((server) => server.stop()))
  }
}

describe('work progress route', () => {
  afterEach(() => RunningWorkApi.stop())

  it('returns the literal identity and partial-progress contract over the real server boundary', async () => {
    const tested = new RunningWorkApi()
    const origin = await tested.start()
    const response = await fetch(`${origin}/work-progress/7?repo=owner%2Fname`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      repo: 'owner/name', issue: 7, agent: 'conversation-7',
      progress: { phase: 'planning', plan: { kind: 'available', value: 'ready' }, activity: { kind: 'unavailable', detail: 'stream unreadable' } },
    })
    expect(tested.requests[0].repository.text).toBe('owner/name')
    expect(tested.requests[0].issue).toBe(7)
  })

  it.each([
    ['/work-progress/no?repo=owner%2Fname', 'malformed-work-issue'],
    ['/work-progress/7?repo=invalid', 'malformed-work-repo'],
    ['/work-progress/7?repo=owner%2Fname&root=/other', 'unknown-work-field'],
  ])('refuses %s before consulting the application', async (path, code) => {
    const tested = new RunningWorkApi()
    const response = await fetch(`${await tested.start()}${path}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code })
    expect(tested.requests).toEqual([])
  })

  it('turns away foreign browser origins before reading work', async () => {
    const tested = new RunningWorkApi()
    const response = await fetch(`${await tested.start()}/work-progress/7?repo=owner%2Fname`, {
      headers: { Origin: 'https://foreign.example' },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'foreign-origin', detail: 'this api only serves the page it hosts' })
    expect(tested.requests).toEqual([])
  })

  it.each([
    [new WorkNotFound('no recorded identity'), 'work-not-found'],
    [new WorkNotRead('disk unavailable'), 'work-not-read'],
    [new WorkNotUnderstood('conflicting identities'), 'work-not-understood'],
  ] as const)('preserves the classified refusal %s in the boundary answer', async (failure, code) => {
    const tested = new RunningWorkApi()
    tested.failure = failure
    const response = await fetch(`${await tested.start()}/work-progress/7?repo=owner%2Fname`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code, detail: failure.message })
  })

  it('refuses mutation methods on the progress query', async () => {
    const tested = new RunningWorkApi()
    const response = await fetch(`${await tested.start()}/work-progress/7?repo=owner%2Fname`, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(tested.requests).toEqual([])
  })
})
