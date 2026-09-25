import * as fs from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CallInvocation, ClaudeCalls } from '../../src/infrastructure/claude-calls.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { InProcessWorkers } from './fixtures/in-process-workers.ts'
import { ScriptedClaude } from './fixtures/scripted-claude.ts'
import { Capture } from './fixtures/scripted-conversation.ts'

class Scenario {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly WORKER = 'worker'

  static invocation(cwd: string): CallInvocation {
    return new CallInvocation({
      conversation: Scenario.CONVERSATION,
      purpose: 'plan',
      cwd,
      argv: ['--session-id', Scenario.CONVERSATION],
      prompt: 'Plan the scripted scenario.',
    })
  }

  static async ready(root: string): Promise<{
    claude: ScriptedClaude,
    workers: InProcessWorkers,
    calls: ClaudeCalls,
  }> {
    const files = new HeadlessFiles({ root, fs, newId: () => 'temporary-record' })
    const claude = new ScriptedClaude(Capture.read('claude', 'result-success'))
    const workers = new InProcessWorkers({ files, claude, worker: Scenario.WORKER })
    const calls = new ClaudeCalls({
      files,
      binary: '/usr/local/bin/claude',
      worker: Scenario.WORKER,
      spawn: workers.launch.bind(workers),
      env: {},
      newId: () => '22222222-2222-4222-8222-222222222222',
      now: () => '2026-09-24T10:00:00.000Z',
      budgetMs: 60_000,
      killGraceMs: 5_000,
      acceptanceMs: 5_000,
      pollMs: 10,
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })

    return { claude, workers, calls }
  }
}

describe('a real ClaudeCalls over InProcessWorkers', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a call through the in-process worker completes from the captured result in the asked conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { claude, workers, calls } = await Scenario.ready(root)

    const call = await calls.start(Scenario.invocation(root))
    await workers.settled()
    const completed = await calls.wait(call)

    expect(completed.succeeded).toBe(true)
    expect(claude.asked).toHaveLength(1)
    expect(claude.asked[0].conversation).toBe(Scenario.CONVERSATION)
    expect(workers.launches).toBe(1)
  })

  it('a launch that is not the headless worker is refused as unscripted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ct-in-process-workers-'))
    roots.push(root)
    const { workers } = await Scenario.ready(root)

    expect(() => workers.launch('/bin/sh', ['-c', 'echo hi'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] }))
      .toThrow(`nobody wrote an answer for /bin/sh -c echo hi in ${root}`)
    expect(workers.launches).toBe(0)
  })
})
